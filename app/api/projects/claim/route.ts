import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'

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

  const project = projectDoc.data()

  // Admins and existing owners don't need to claim
  if (hasSystemRole(auth, 'admin') || project?.requester_id === auth.uid) {
    return NextResponse.json({ claimed: true, project_id })
  }

  // Check membership by email
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', project_id)
    .where('email', '==', auth.email)
    .limit(1)
    .get()

  // Also check legacy requester_email
  const hasLegacyAccess = project?.requester_email === auth.email

  if (memberSnap.empty && !hasLegacyAccess) {
    return NextResponse.json({ error: 'This project was not shared with you' }, { status: 403 })
  }

  const now = new Date().toISOString()

  // Update membership record with user_id if it exists
  if (!memberSnap.empty) {
    const memberDoc = memberSnap.docs[0]
    if (!memberDoc.data().user_id) {
      await memberDoc.ref.update({
        user_id: auth.uid,
        updated_at: now,
      })
    }
  } else if (hasLegacyAccess) {
    // Create membership record from legacy access
    await db.collection('project_members').add({
      project_id,
      user_id: auth.uid,
      email: auth.email,
      role: 'maker',
      added_by: 'system-migration',
      created_at: now,
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
