import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, canAccessProject } from '@/lib/api/firebase-server-helpers'

// GET /api/briefs?project_id=xxx — get the latest brief for a project
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  // Verify ownership
  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists || !canAccessProject(projectDoc.data()!, auth.uid, auth.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snapshot = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (snapshot.empty) {
    return NextResponse.json(null)
  }

  const doc = snapshot.docs[0]
  return NextResponse.json({ id: doc.id, ...doc.data() })
}
