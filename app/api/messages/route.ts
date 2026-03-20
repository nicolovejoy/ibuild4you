import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, canAccessProject, requireAdmin } from '@/lib/api/firebase-server-helpers'

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

  // Look up the session to get its project, then verify ownership
  const sessionDoc = await db.collection('sessions').doc(sessionId).get()
  if (!sessionDoc.exists) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const projectId = sessionDoc.data()?.project_id
  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists || !canAccessProject(projectDoc.data()!, auth.uid, auth.email)) {
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

// DELETE /api/messages?message_id=xxx — delete a single message (admin-only)
export async function DELETE(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const adminCheck = requireAdmin(auth.email)
  if (adminCheck) return adminCheck

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

  await db.collection('messages').doc(messageId).delete()

  return NextResponse.json({ deleted: true, message_id: messageId })
}
