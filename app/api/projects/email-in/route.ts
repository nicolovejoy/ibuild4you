import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { mintEmailInAddress, randomTail } from '@/lib/email-in/address'

const MAX_MINT_ATTEMPTS = 5

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

  const projectRef = db.collection('projects').doc(projectId)
  const projectDoc = await projectRef.get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const project = projectDoc.data() as { slug?: string; email_in_address?: string }

  if (project.email_in_address) {
    return NextResponse.json({ address: project.email_in_address })
  }

  // The tail is random, so a collision is rare; a few tries are plenty.
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
    const address = mintEmailInAddress(project.slug, randomTail())
    const taken = await db
      .collection('projects')
      .where('email_in_address', '==', address)
      .limit(1)
      .get()
    if (!taken.empty) continue

    await projectRef.update({ email_in_address: address })
    return NextResponse.json({ address })
  }

  console.error('email-in mint failed: address collisions', { projectId, attempts: MAX_MINT_ATTEMPTS })
  return NextResponse.json({ error: 'Could not mint an address' }, { status: 500 })
}
