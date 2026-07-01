import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { planAccessTierChange, type MemberRow } from '@/lib/members/lifecycle'
import type { MemberRole } from '@/lib/types'

// PATCH /api/projects/[id]/members/[memberId] — builder+ changes a member's
// access tier (#106 P1). Body: { role: MemberRole }. The last active owner
// can't be demoted (planAccessTierChange guards it). brief_role stays on
// PATCH /api/projects/role; this route is the access-tier axis.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id: projectId, memberId } = await params
  if (!projectId || !memberId) {
    return NextResponse.json({ error: 'project id and member id are required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getAdminDb()
  const callerRole = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  // Load the whole roster — the last-owner guard needs the full active set.
  const snap = await db.collection('project_members').where('project_id', '==', projectId).get()
  const members: MemberRow[] = snap.docs.map((d) => ({
    id: d.id,
    email: (d.data().email as string) || '',
    role: d.data().role as MemberRole,
    removed_at: (d.data().removed_at as string | null | undefined) ?? null,
  }))

  const plan = planAccessTierChange({ members, memberId, newRole: body.role, now: new Date().toISOString() })
  if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 })

  await db.collection('project_members').doc(memberId).update(plan.patch)
  return NextResponse.json({ ok: true, role: plan.patch.role })
}
