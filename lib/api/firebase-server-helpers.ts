import { NextResponse } from 'next/server'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { ADMIN_EMAILS, isAdminEmail } from '@/lib/constants'
import type { MemberRole } from '@/lib/types'

export { ADMIN_EMAILS, isAdminEmail }

// --- Permission ladder ---
// owner > builder > apprentice > maker
// Each level includes everything below it.

const ROLE_RANK: Record<MemberRole, number> = {
  maker: 0,
  apprentice: 1,
  builder: 2,
  owner: 3,
}

export function canChat(role: MemberRole | null): boolean {
  return role !== null // maker+
}

export function canReview(role: MemberRole | null): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK['apprentice']
}

export function canConfigure(role: MemberRole | null): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK['builder']
}

export function canManage(role: MemberRole | null): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK['owner']
}

// Look up a user's role on a project via project_members collection.
// Falls back to ADMIN_EMAILS → implicit owner.
// Returns null if no access.
export async function getProjectRole(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  userId: string,
  email: string
): Promise<MemberRole | null> {
  // Instance admins get implicit owner on all projects
  if (isAdminEmail(email)) return 'owner'

  // Check explicit membership
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('user_id', '==', userId)
    .limit(1)
    .get()

  if (!memberSnap.empty) {
    return memberSnap.docs[0].data().role as MemberRole
  }

  // Also check by email (for users who haven't claimed yet — user_id may differ)
  const emailSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('email', '==', email)
    .limit(1)
    .get()

  if (!emailSnap.empty) {
    return emailSnap.docs[0].data().role as MemberRole
  }

  // Legacy fallback: check requester_id / requester_email on the project doc
  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (projectDoc.exists) {
    const data = projectDoc.data()!
    if (data.requester_id === userId || data.requester_email === email) {
      return 'maker'
    }
  }

  return null
}

// Require a minimum role on a project. Returns a 403 response if insufficient, or null if OK.
export function requireRole(
  role: MemberRole | null,
  minimum: MemberRole
): NextResponse | null {
  if (role === null || ROLE_RANK[role] < ROLE_RANK[minimum]) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

type AuthSuccess = {
  uid: string
  email: string
  displayName: string | null
  error: null
}

type AuthFailure = {
  uid: null
  email: null
  error: NextResponse
}

export async function getAuthenticatedUser(request: Request): Promise<AuthSuccess | AuthFailure> {
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return {
      uid: null,
      email: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token)
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      displayName: (decoded.name as string) || null,
      error: null,
    }
  } catch {
    return {
      uid: null,
      email: null,
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    }
  }
}

// Look up a user's display name from the users collection.
// Returns "First L" format, or email prefix as fallback.
export async function getUserDisplayName(
  db: FirebaseFirestore.Firestore,
  uid: string,
  email: string
): Promise<string> {
  const userDoc = await db.collection('users').doc(uid).get()
  if (userDoc.exists) {
    const data = userDoc.data()!
    const firstName = data.first_name as string | undefined
    const lastName = data.last_name as string | undefined
    if (firstName) {
      return lastName ? `${firstName} ${lastName.charAt(0)}` : firstName
    }
  }
  // Fallback: email prefix
  return email.split('@')[0]
}

export async function isApprovedEmail(email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true

  const db = getAdminDb()
  const doc = await db.collection('approved_emails').doc(email).get()
  return doc.exists
}

export { getAdminDb }
