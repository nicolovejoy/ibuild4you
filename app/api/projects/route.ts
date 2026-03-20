import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, requireAdmin } from '@/lib/api/firebase-server-helpers'

// GET /api/projects — list the current user's projects (owned + shared with them)
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const db = getAdminDb()

  // Projects the user owns
  const ownedSnap = await db
    .collection('projects')
    .where('requester_id', '==', auth.uid)
    .orderBy('created_at', 'desc')
    .get()

  // Projects shared with the user's email (not yet claimed)
  const sharedSnap = await db
    .collection('projects')
    .where('requester_email', '==', auth.email)
    .orderBy('created_at', 'desc')
    .get()

  // Merge and deduplicate
  const seen = new Set<string>()
  const projects = []
  for (const doc of [...ownedSnap.docs, ...sharedSnap.docs]) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id)
      projects.push({ id: doc.id, ...doc.data() })
    }
  }

  return NextResponse.json(projects)
}

// PATCH /api/projects — update project setup fields (admin-only)
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const adminCheck = requireAdmin(auth.email)
  if (adminCheck) return adminCheck

  const body = await request.json()
  const { project_id, ...updates } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Only allow updating specific setup fields
  const allowed = ['welcome_message', 'seed_questions', 'style_guide', 'context', 'title'] as const
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in updates) {
      patch[key] = updates[key]
    }
  }

  await db.collection('projects').doc(project_id).update(patch)

  return NextResponse.json({ id: project_id, ...patch })
}

// DELETE /api/projects?project_id=xxx — delete a project and all related data (admin-only)
export async function DELETE(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const adminCheck = requireAdmin(auth.email)
  if (adminCheck) return adminCheck

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  // Verify project exists
  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Collect all docs to delete
  const docsToDelete: FirebaseFirestore.DocumentReference[] = []

  // Sessions and their messages
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .get()

  for (const sessionDoc of sessionsSnap.docs) {
    const messagesSnap = await db
      .collection('messages')
      .where('session_id', '==', sessionDoc.id)
      .get()
    messagesSnap.docs.forEach((doc) => docsToDelete.push(doc.ref))
    docsToDelete.push(sessionDoc.ref)
  }

  // Briefs
  const briefsSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .get()
  briefsSnap.docs.forEach((doc) => docsToDelete.push(doc.ref))

  // The project itself
  docsToDelete.push(db.collection('projects').doc(projectId))

  // Batch delete in chunks of 450 (Firestore limit is 500 per batch)
  for (let i = 0; i < docsToDelete.length; i += 450) {
    const batch = db.batch()
    docsToDelete.slice(i, i + 450).forEach((ref) => batch.delete(ref))
    await batch.commit()
  }

  return NextResponse.json({ deleted: true, project_id: projectId })
}

// POST /api/projects — create a new project
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { title, context } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  const projectData: Record<string, unknown> = {
    requester_id: auth.uid,
    title: title.trim(),
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  if (context?.trim()) {
    projectData.context = context.trim()
  }

  const docRef = await db.collection('projects').add(projectData)

  // Create the first session for the project automatically
  const sessionRef = await db.collection('sessions').add({
    project_id: docRef.id,
    status: 'active',
    created_at: now,
    updated_at: now,
  })

  const project = {
    id: docRef.id,
    requester_id: auth.uid,
    title: title.trim(),
    status: 'active',
    created_at: now,
    updated_at: now,
  }

  return NextResponse.json({ ...project, session_id: sessionRef.id }, { status: 201 })
}
