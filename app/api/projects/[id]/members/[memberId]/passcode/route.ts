import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { generatePasscode } from '@/lib/passcode'

// GET /api/projects/[id]/members/[memberId]/passcode — reveal a single member's
// sign-in passcode so an owner/builder can re-send a previously-invited person
// THEIR OWN credentials (#81). Mints one if the row never got a passcode.
//
// Why this exists: after the initial invite, the only creds the share UI
// surfaced were the originator's. Handing those to a 2nd/3rd person would log
// them in AS the originator — passcode auth matches email AND passcode together.
// On-demand reveal (not carried in the members list payload) keeps the secret
// out of every panel load.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id: projectId, memberId } = await params
  if (!projectId || !memberId) {
    return NextResponse.json(
      { error: 'project id and member id are required' },
      { status: 400 }
    )
  }

  const db = getAdminDb()
  const callerRole = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  const memberRef = db.collection('project_members').doc(memberId)
  const memberSnap = await memberRef.get()
  // Guard the cross-project case: a valid member id from another brief must not
  // leak its passcode through this brief's route.
  if (!memberSnap.exists || memberSnap.data()?.project_id !== projectId) {
    return NextResponse.json({ error: 'member not found' }, { status: 404 })
  }

  const data = memberSnap.data() || {}
  let passcode = data.passcode as string | undefined
  if (!passcode) {
    passcode = generatePasscode()
    await memberRef.update({ passcode, updated_at: new Date().toISOString() })
  }

  return NextResponse.json({ passcode, email: (data.email as string) || '' })
}
