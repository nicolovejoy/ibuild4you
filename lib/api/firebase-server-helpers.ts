import { NextResponse } from 'next/server'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { ADMIN_EMAILS, isAdminEmail } from '@/lib/constants'

export { ADMIN_EMAILS, isAdminEmail }

export function requireAdmin(email: string | null): NextResponse | null {
  if (!isAdminEmail(email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

type AuthSuccess = {
  uid: string
  email: string
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

// Check if a user can access a project (owner or shared requester)
export function canAccessProject(
  projectData: Record<string, unknown>,
  uid: string,
  email: string
): boolean {
  return (
    projectData.requester_id === uid ||
    projectData.requester_email === email ||
    isAdminEmail(email)
  )
}

export async function isApprovedEmail(email: string): Promise<boolean> {
  // Admins are always approved
  if (isAdminEmail(email)) return true

  const db = getAdminDb()
  const doc = await db.collection('approved_emails').doc(email).get()
  return doc.exists
}

export { getAdminDb }
