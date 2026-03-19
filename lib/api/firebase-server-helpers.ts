import { NextResponse } from 'next/server'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { ADMIN_EMAILS } from '@/lib/constants'

export { ADMIN_EMAILS }

export function isAdminEmail(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email)
}

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

export async function isApprovedEmail(email: string): Promise<boolean> {
  // Admins are always approved
  if (isAdminEmail(email)) return true

  const db = getAdminDb()
  const doc = await db.collection('approved_emails').doc(email).get()
  return doc.exists
}

export { getAdminDb }
