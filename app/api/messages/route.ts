import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb } from '@/lib/api/firebase-server-helpers'

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
  if (!projectDoc.exists || projectDoc.data()?.requester_id !== auth.uid) {
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
