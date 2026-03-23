import { NextResponse } from 'next/server'
import crypto from 'crypto'
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

      // Get recent messages to derive last activity and last maker message
      const sessionIds = sessionsSnap.docs.map((d) => d.id)
      let lastMessageAt: string | null = null
      let lastMessageBy: string | null = null
      let lastMakerMessageAt: string | null = null

      if (sessionIds.length > 0) {
        // Firestore 'in' queries support up to 30 values
        for (let i = 0; i < sessionIds.length; i += 30) {
          const chunk = sessionIds.slice(i, i + 30)

          // Fetch recent messages (enough to find the last maker message)
          const msgSnap = await db
            .collection('messages')
            .where('session_id', 'in', chunk)
            .orderBy('created_at', 'desc')
            .limit(10)
            .get()

          for (const doc of msgSnap.docs) {
            const msg = doc.data()
            // Track overall last message
            if (!lastMessageAt || msg.created_at > lastMessageAt) {
              lastMessageAt = msg.created_at as string
              lastMessageBy = msg.role === 'user'
                ? (msg.sender_email as string) || null
                : 'agent'
            }
            // Track last maker (user) message
            if (msg.role === 'user' && (!lastMakerMessageAt || msg.created_at > lastMakerMessageAt)) {
              lastMakerMessageAt = msg.created_at as string
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

      // Find latest session created_at
      let latestSessionCreatedAt: string | null = null
      for (const doc of sessionsSnap.docs) {
        const createdAt = doc.data().created_at as string
        if (!latestSessionCreatedAt || createdAt > latestSessionCreatedAt) {
          latestSessionCreatedAt = createdAt
        }
      }

      return {
        ...project,
        session_count: sessionsSnap.size,
        last_message_at: lastMessageAt,
        last_message_by: lastMessageBy,
        last_maker_message_at: lastMakerMessageAt,
        latest_session_created_at: latestSessionCreatedAt,
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
  const allowed = ['welcome_message', 'seed_questions', 'context', 'title', 'builder_directives', 'session_mode', 'requester_first_name', 'requester_last_name', 'last_nudged_at', 'last_builder_activity_at', 'layout_mockups'] as const
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
// Accepts full setup payload: title (required), plus optional context,
// requester info, session config, and layout mockups.
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { title } = body

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

  // Optional setup fields — include only if provided
  const optionalStrings = ['context', 'requester_first_name', 'requester_last_name', 'requester_email', 'welcome_message'] as const
  for (const field of optionalStrings) {
    if (typeof body[field] === 'string' && body[field].trim()) {
      projectData[field] = body[field].trim()
    }
  }
  if (body.session_mode === 'discover' || body.session_mode === 'converge') {
    projectData.session_mode = body.session_mode
  }
  if (Array.isArray(body.seed_questions) && body.seed_questions.length > 0) {
    projectData.seed_questions = body.seed_questions.filter((q: unknown) => typeof q === 'string' && q.trim())
  }
  if (Array.isArray(body.builder_directives) && body.builder_directives.length > 0) {
    projectData.builder_directives = body.builder_directives.filter((d: unknown) => typeof d === 'string' && d.trim())
  }
  if (Array.isArray(body.layout_mockups) && body.layout_mockups.length > 0) {
    projectData.layout_mockups = body.layout_mockups
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

  // If requester_email provided, create maker membership + approve email
  const requesterEmail = projectData.requester_email as string | undefined
  if (requesterEmail) {
    const passcode = crypto.randomBytes(4).toString('base64url').slice(0, 6).toUpperCase()
    const makerData: Record<string, unknown> = {
      project_id: docRef.id,
      user_id: '',
      email: requesterEmail,
      role: 'maker',
      passcode,
      added_by: auth.email,
      created_at: now,
      updated_at: now,
    }
    if (projectData.requester_first_name) makerData.first_name = projectData.requester_first_name
    if (projectData.requester_last_name) makerData.last_name = projectData.requester_last_name
    await db.collection('project_members').add(makerData)

    // Approve email so they can sign in
    await db.collection('approved_emails').add({
      email: requesterEmail,
      approved_by: auth.email,
      created_at: now,
    })

    // Mark project as shared
    projectData.shared_at = now
  }

  // Create the first session, snapshotting any config provided
  const sessionData: Record<string, unknown> = {
    project_id: docRef.id,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  // Snapshot config fields onto the session so it captures the initial setup
  for (const field of ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'layout_mockups'] as const) {
    if (projectData[field] !== undefined) {
      sessionData[field] = projectData[field]
    }
  }
  const sessionRef = await db.collection('sessions').add(sessionData)

  return NextResponse.json({ ...projectData, id: docRef.id, session_id: sessionRef.id }, { status: 201 })
}
