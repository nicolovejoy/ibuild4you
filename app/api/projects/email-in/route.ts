import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { mintEmailInAddress, randomTail } from '@/lib/email-in/address'
import { listProjectEmails } from '@/lib/email-in/store'
import { emailProjectOf, loadSenderMembers } from '@/lib/email-in/members'
import { emailPreview, readProjectEmails } from '@/lib/email-in/reading'

const MAX_MINT_ATTEMPTS = 5
// notes_through_at for a project with no brief and no note: earlier than any
// stored timestamp, so the writer reads everything, as it does with none set.
const NOTHING_COVERED_YET = '1970-01-01T00:00:00.000Z'
const RECENT_EMAILS = 10

// A stored counter as a number: 0 when missing or not a number.
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// GET /api/projects/email-in?project_id= — what the Setup panel shows (builder+):
// the address (null until minted), the newest emails as id/who/when/subject with
// the start of what the sender typed, and the drop counters with when the last
// drop was. Never an email's sender address, attachments or quoted text; one
// email in full is read through ./message.
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
      last_at?: unknown
      last_auth_failed_from?: unknown
    }
  }
  const dropped = project.email_in_dropped ?? {}

  // The newest 10, newest first. The preview is the start of what the sender
  // typed in the reading the message route serves, and what counts as typed and
  // new depends on the emails before, so every email of the project is read.
  const emails = await listProjectEmails(db, projectId)
  const members = emails.length > 0 ? await loadSenderMembers(db, emailProjectOf(projectId, projectDoc.data())) : []
  const recent = readProjectEmails(emails, members)
    .slice(-RECENT_EMAILS)
    .reverse()
    .map(({ email, typed }) => ({
      id: email.id,
      from_name: email.from_name,
      from_role: email.from_role,
      received_at: email.received_at,
      subject: email.subject,
      preview: emailPreview(typed),
    }))

  return NextResponse.json({
    address: project.email_in_address ?? null,
    recent,
    dropped: {
      not_member: count(dropped.not_member),
      auth_failed: count(dropped.auth_failed),
      over_limit: count(dropped.over_limit),
      last_at: typeof dropped.last_at === 'string' ? dropped.last_at : null,
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
    // covered check) start at the live brief's updated_at, or at the very
    // beginning when there is no brief. A brief save after an email arrived but
    // before its first note would move that start past the email, and no note
    // would read it. So the start is pinned once, here, where it stood: the
    // brief's updated_at, else the epoch (nothing covered yet, so chat from
    // before the mint is still noted). Never now, which would skip that chat.
    // The brief is found as the writer and the cron find it.
    let notesThroughAt: string | null = null
    if (!project.notes_through_at) {
      const briefSnap = await tx.get(
        db.collection('briefs').where('project_id', '==', projectId).orderBy('version', 'desc').limit(1),
      )
      const briefUpdatedAt = briefSnap.empty ? undefined : briefSnap.docs[0].data().updated_at
      notesThroughAt =
        typeof briefUpdatedAt === 'string' && briefUpdatedAt ? briefUpdatedAt : NOTHING_COVERED_YET
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
