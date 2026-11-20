import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { mintEmailInAddress, randomTail } from '@/lib/email-in/address'
import { listRecentProjectEmailRows } from '@/lib/email-in/store'

const MAX_MINT_ATTEMPTS = 5
const RECENT_EMAILS = 10

// A stored counter as a number: 0 when missing or not a number.
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// GET /api/projects/email-in?project_id= — what the Setup panel shows (builder+):
// the address (null until minted), the newest emails as who/when/subject, and
// the drop counters. Never an email's text, sender address or attachments.
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const project = projectDoc.data() as {
    email_in_address?: string
    email_in_dropped?: {
      not_member?: unknown
      auth_failed?: unknown
      over_limit?: unknown
      last_auth_failed_from?: unknown
    }
  }
  const dropped = project.email_in_dropped ?? {}

  // The newest 10, newest first, read without the emails' text.
  const recent = await listRecentProjectEmailRows(db, projectId, RECENT_EMAILS)

  return NextResponse.json({
    address: project.email_in_address ?? null,
    recent,
    dropped: {
      not_member: count(dropped.not_member),
      auth_failed: count(dropped.auth_failed),
      over_limit: count(dropped.over_limit),
      last_auth_failed_from:
        typeof dropped.last_auth_failed_from === 'string' ? dropped.last_auth_failed_from : null,
    },
  })
}

// POST /api/projects/email-in { project_id } — the project's email address
// (builder+). Minted once: a project that already has one gets it back
// unchanged. Otherwise a new one is minted, checked against every other
// project, and stored.
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json().catch(() => null)
  const projectId = body?.project_id
  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  // Read, check and write in one transaction. Two requests at once (a double
  // click, two builders) cannot both mint: Firestore retries the loser, which
  // re-reads, finds the address the first one stored, and returns it. An
  // address that was handed out is never replaced.
  const projectRef = db.collection('projects').doc(projectId)
  const result = await db.runTransaction(async (tx) => {
    const projectDoc = await tx.get(projectRef)
    if (!projectDoc.exists) return { status: 'not_found' as const }
    const project = projectDoc.data() as {
      slug?: string
      email_in_address?: string
      notes_through_at?: string | null
    }

    if (project.email_in_address) {
      return { status: 'ok' as const, address: project.email_in_address }
    }

    // A project with no notes_through_at has its note writer (and the cron's
    // covered check) start at the live brief's updated_at. A brief save after
    // an email arrived but before its first note would move that start past
    // the email, and no note would read it. So the start is pinned once, here,
    // where it stood: the brief's updated_at, else now. The brief is found as
    // the writer and the cron find it.
    let notesThroughAt: string | null = null
    if (!project.notes_through_at) {
      const briefSnap = await tx.get(
        db.collection('briefs').where('project_id', '==', projectId).orderBy('version', 'desc').limit(1),
      )
      const briefUpdatedAt = briefSnap.empty ? undefined : briefSnap.docs[0].data().updated_at
      notesThroughAt =
        typeof briefUpdatedAt === 'string' && briefUpdatedAt ? briefUpdatedAt : new Date().toISOString()
    }

    // The tail is random, so a collision is rare; a few tries are plenty.
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
      const address = mintEmailInAddress(project.slug, randomTail())
      const taken = await tx.get(
        db.collection('projects').where('email_in_address', '==', address).limit(1),
      )
      if (!taken.empty) continue

      tx.update(projectRef, {
        email_in_address: address,
        ...(notesThroughAt && { notes_through_at: notesThroughAt }),
      })
      return { status: 'ok' as const, address }
    }
    return { status: 'collisions' as const }
  })

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  if (result.status === 'collisions') {
    console.error('email-in mint failed: address collisions', { projectId, attempts: MAX_MINT_ATTEMPTS })
    return NextResponse.json({ error: 'Could not mint an address' }, { status: 500 })
  }
  return NextResponse.json({ address: result.address })
}
