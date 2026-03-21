import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
  isAdminEmail,
} from '@/lib/api/firebase-server-helpers'

// Enrich project docs with last activity and session count
async function enrichProjects(
  db: FirebaseFirestore.Firestore,
  projectDocs: { id: string; [key: string]: unknown }[]
) {
  return Promise.all(
    projectDocs.map(async (project) => {
      // Get session count
      const sessionsSnap = await db
        .collection('sessions')
        .where('project_id', '==', project.id)
        .get()

      // Get most recent user message across all sessions
      const sessionIds = sessionsSnap.docs.map((d) => d.id)
      let lastMessageAt: string | null = null
      let lastMessageBy: string | null = null

      if (sessionIds.length > 0) {
        // Firestore 'in' queries support up to 30 values
        for (let i = 0; i < sessionIds.length; i += 30) {
          const chunk = sessionIds.slice(i, i + 30)
          const msgSnap = await db
            .collection('messages')
            .where('session_id', 'in', chunk)
            .orderBy('created_at', 'desc')
            .limit(1)
            .get()

          if (!msgSnap.empty) {
            const msg = msgSnap.docs[0].data()
            if (!lastMessageAt || msg.created_at > lastMessageAt) {
              lastMessageAt = msg.created_at as string
              lastMessageBy = msg.role === 'user'
                ? (msg.sender_email as string) || null
                : 'agent'
            }
          }
        }
      }

      // Get latest brief
      const briefSnap = await db
        .collection('briefs')
        .where('project_id', '==', project.id)
        .orderBy('version', 'desc')
        .limit(1)
        .get()

      let briefVersion: number | null = null
      let briefDecisionCount: number | null = null
      let briefFeatureCount: number | null = null
      if (!briefSnap.empty) {
        const briefData = briefSnap.docs[0].data()
        briefVersion = (briefData.version as number) || null
        const content = briefData.content as { decisions?: unknown[]; features?: unknown[] } | undefined
        briefDecisionCount = Array.isArray(content?.decisions) ? content.decisions.length : 0
        briefFeatureCount = Array.isArray(content?.features) ? content.features.length : 0
      }

      return {
        ...project,
        session_count: sessionsSnap.size,
        last_message_at: lastMessageAt,
        last_message_by: lastMessageBy,
        brief_version: briefVersion,
        brief_decision_count: briefDecisionCount,
        brief_feature_count: briefFeatureCount,
      }
    })
  )
}

// GET /api/projects — list projects the current user has membership on
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const db = getAdminDb()

  // Admins see all projects
  if (isAdminEmail(auth.email)) {
    const allSnap = await db
      .collection('projects')
      .orderBy('created_at', 'desc')
      .get()
    const projects = allSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    return NextResponse.json(await enrichProjects(db, projects))
  }

  // Get project IDs from membership
  const memberSnap = await db
    .collection('project_members')
    .where('user_id', '==', auth.uid)
    .get()

  const memberByEmail = await db
    .collection('project_members')
    .where('email', '==', auth.email)
    .get()

  // Also check legacy: projects where requester_id or requester_email matches
  const ownedSnap = await db
    .collection('projects')
    .where('requester_id', '==', auth.uid)
    .orderBy('created_at', 'desc')
    .get()

  const sharedSnap = await db
    .collection('projects')
    .where('requester_email', '==', auth.email)
    .orderBy('created_at', 'desc')
    .get()

  // Collect all project IDs
  const projectIds = new Set<string>()
  for (const doc of memberSnap.docs) projectIds.add(doc.data().project_id as string)
  for (const doc of memberByEmail.docs) projectIds.add(doc.data().project_id as string)
  for (const doc of ownedSnap.docs) projectIds.add(doc.id)
  for (const doc of sharedSnap.docs) projectIds.add(doc.id)

  if (projectIds.size === 0) {
    return NextResponse.json([])
  }

  // Fetch all project docs
  const projectIdArray = Array.from(projectIds)
  const projects: { id: string; [key: string]: unknown }[] = []

  // Firestore 'in' queries support up to 30 values
  for (let i = 0; i < projectIdArray.length; i += 30) {
    const chunk = projectIdArray.slice(i, i + 30)
    const snap = await db
      .collection('projects')
      .where('__name__', 'in', chunk)
      .get()
    for (const doc of snap.docs) {
      projects.push({ id: doc.id, ...doc.data() })
    }
  }

  // Sort by created_at desc
  projects.sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string))

  return NextResponse.json(await enrichProjects(db, projects))
}

// PATCH /api/projects — update project setup fields (builder+)
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, ...updates } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, project_id, auth.uid, auth.email)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Only allow updating specific setup fields
  const allowed = ['welcome_message', 'seed_questions', 'style_guide', 'context', 'title', 'builder_directives', 'session_mode'] as const
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in updates) {
      patch[key] = updates[key]
    }
  }

  await db.collection('projects').doc(project_id).update(patch)

  return NextResponse.json({ id: project_id, ...patch })
}

// DELETE /api/projects?project_id=xxx — delete a project and all related data (owner only)
export async function DELETE(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email)
  const roleCheck = requireRole(role, 'owner')
  if (roleCheck) return roleCheck

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

  // Project members
  const membersSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .get()
  membersSnap.docs.forEach((doc) => docsToDelete.push(doc.ref))

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

  // Create owner membership for the creator
  await db.collection('project_members').add({
    project_id: docRef.id,
    user_id: auth.uid,
    email: auth.email,
    role: 'owner',
    added_by: auth.email,
    created_at: now,
    updated_at: now,
  })

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
