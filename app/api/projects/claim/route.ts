import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { normalizeEmail } from '@/lib/email/normalize'

// POST /api/projects/claim — claim a project that was shared with you
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const projectDoc = await db.collection('projects').doc(project_id).get()

  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Admins don't need to claim. (The old requester_id short-circuit was an
  // authz read on a display-only field — gone, Garm PR E. Membership is the
  // only access source below.)
  if (hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ claimed: true, project_id })
  }

  // Defensive normalize (#155) — auth.email is already normalized at the
  // token boundary, but this is an authz decision, so don't depend on that.
  const email = normalizeEmail(auth.email)

  // Check membership by email
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', project_id)
    .where('email', '==', email)
    .limit(1)
    .get()

  if (memberSnap.empty) {
    return NextResponse.json({ error: 'This project was not shared with you' }, { status: 403 })
  }

  const now = new Date().toISOString()

  // Update membership record with user_id if it exists
  const memberDoc = memberSnap.docs[0]
  if (!memberDoc.data().user_id) {
    await memberDoc.ref.update({
      user_id: auth.uid,
      updated_at: now,
    })
  }

  // Transfer ownership on the project doc
  await db.collection('projects').doc(project_id).update({
    requester_id: auth.uid,
    updated_at: now,
  })

  return NextResponse.json({ claimed: true, project_id })
}
