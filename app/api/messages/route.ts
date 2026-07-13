import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'

// GET /api/messages?session_id=xxx — list messages for a session
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')

  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  // Look up the session to get its project, then verify membership
  const sessionDoc = await db.collection('sessions').doc(sessionId).get()
  if (!sessionDoc.exists) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const projectId = sessionDoc.data()?.project_id
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snapshot = await db
    .collection('messages')
    .where('session_id', '==', sessionId)
    .orderBy('created_at', 'asc')
    .get()

  const messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(messages)
}

// PATCH /api/messages — rate an agent message 👍/👎 (#130). Any member may
// rate (makers are the point); only agent messages are ratable. Body:
// { message_id, rating: 'up' | 'down' | null } — null clears the rating.
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { message_id, rating } = body

  if (!message_id) {
    return NextResponse.json({ error: 'message_id is required' }, { status: 400 })
  }
  if (rating !== 'up' && rating !== 'down' && rating !== null) {
    return NextResponse.json({ error: "rating must be 'up', 'down', or null" }, { status: 400 })
  }

  const db = getAdminDb()
  const messageDoc = await db.collection('messages').doc(message_id).get()
  if (!messageDoc.exists) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
  if (messageDoc.data()?.role !== 'agent') {
    return NextResponse.json({ error: 'Only agent messages can be rated' }, { status: 400 })
  }

  // Look up the session → project to verify membership (any role may rate)
  const sessionId = messageDoc.data()?.session_id
  const sessionDoc = await db.collection('sessions').doc(sessionId).get()
  if (!sessionDoc.exists) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const projectId = sessionDoc.data()?.project_id
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await db.collection('messages').doc(message_id).update({
    rating,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ message_id, rating })
}

// DELETE /api/messages?message_id=xxx — delete a single message (builder+)
export async function DELETE(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const messageId = searchParams.get('message_id')

  if (!messageId) {
    return NextResponse.json({ error: 'message_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const messageDoc = await db.collection('messages').doc(messageId).get()

  if (!messageDoc.exists) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // Look up the session → project to verify role
  const sessionId = messageDoc.data()?.session_id
  const sessionDoc = await db.collection('sessions').doc(sessionId).get()
  if (!sessionDoc.exists) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const projectId = sessionDoc.data()?.project_id
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  await db.collection('messages').doc(messageId).delete()

  return NextResponse.json({ deleted: true, message_id: messageId })
}
