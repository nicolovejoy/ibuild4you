import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
  type AuthSuccess,
} from '@/lib/api/firebase-server-helpers'
import {
  planAccessTierChange,
  planRemoveMember,
  planRestoreMember,
  type MemberRow,
  type LifecyclePlan,
} from '@/lib/members/lifecycle'
import type { MemberRole } from '@/lib/types'
import { scheduleGarmGrantSync } from '@/lib/garm-grants'

// Member-scoped access-tier + lifecycle ops (#106). All builder+.
//   PATCH  { role }            → change access tier
//   PATCH  { removed: false }  → restore a moved-out member
//   DELETE                     → move a member out (non-destructive)

type Roster =
  | { ok: false; response: NextResponse }
  | { ok: true; db: FirebaseFirestore.Firestore; members: MemberRow[]; auth: AuthSuccess }

// Auth + load the whole roster (the last-owner guards need the full active set).
// Returns an early NextResponse on failure, or the db/members/auth to act on.
async function loadRoster(request: Request, projectId: string, memberId: string): Promise<Roster> {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return { ok: false, response: auth.error }

  if (!projectId || !memberId) {
    return { ok: false, response: NextResponse.json({ error: 'project id and member id are required' }, { status: 400 }) }
  }

  const db = getAdminDb()
  const callerRole = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return { ok: false, response: roleCheck }

  const snap = await db.collection('project_members').where('project_id', '==', projectId).get()
  const members: MemberRow[] = snap.docs.map((d) => ({
    id: d.id,
    email: (d.data().email as string) || '',
    role: d.data().role as MemberRole,
    removed_at: (d.data().removed_at as string | null | undefined) ?? null,
  }))

  return { ok: true, db, members, auth }
}

// Apply a planner result to the target doc, or surface its error as a 400.
// `email` (the target member's, from the already-loaded roster) drives the
// post-write Garm dual-write sync — a no-op unless GARM_DUAL_WRITE=on.
async function apply(
  db: FirebaseFirestore.Firestore,
  memberId: string,
  email: string,
  plan: LifecyclePlan
) {
  if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 })
  await db.collection('project_members').doc(memberId).update(plan.patch)
  scheduleGarmGrantSync(email)
  return NextResponse.json({ ok: true, ...plan.patch })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
): Promise<NextResponse> {
  const { id: projectId, memberId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const loaded = await loadRoster(request, projectId, memberId)
  if (!loaded.ok) return loaded.response
  const { db, members } = loaded
  const now = new Date().toISOString()
  const targetEmail = members.find((m) => m.id === memberId)?.email ?? ''

  if (body.removed === false) {
    return apply(db, memberId, targetEmail, planRestoreMember({ members, memberId, now }))
  }
  if ('role' in body) {
    return apply(db, memberId, targetEmail, planAccessTierChange({ members, memberId, newRole: body.role, now }))
  }
  return NextResponse.json({ error: 'Provide { role } to change tier or { removed: false } to restore.' }, { status: 400 })
}

// DELETE — move a member out of the brief (non-destructive: sets removed_at).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
): Promise<NextResponse> {
  const { id: projectId, memberId } = await params

  const loaded = await loadRoster(request, projectId, memberId)
  if (!loaded.ok) return loaded.response
  const { db, members, auth } = loaded
  const targetEmail = members.find((m) => m.id === memberId)?.email ?? ''

  return apply(
    db,
    memberId,
    targetEmail,
    planRemoveMember({ members, memberId, actorEmail: auth.email, now: new Date().toISOString() })
  )
}
