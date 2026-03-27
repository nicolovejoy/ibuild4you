import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  hasSystemRole,
  isApprovedEmail,
} from '@/lib/api/firebase-server-helpers'
import { isAdminEmail } from '@/lib/constants'

// GET /api/approved-emails — check if the current user's email is approved
// Also upserts the user doc with names from the auth token (Google sign-in)
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const approved = await isApprovedEmail(auth.email, auth.systemRoles)

  // Upsert user doc with name from auth provider and system_roles for admins
  if (approved) {
    const db = getAdminDb()
    const userRef = db.collection('users').doc(auth.uid)
    const userDoc = await userRef.get()
    const userData = userDoc.data()
    const needsName = auth.displayName && (!userDoc.exists || !userData?.first_name)
    const needsRoles = isAdminEmail(auth.email) && !Array.isArray(userData?.system_roles)

    if (needsName || needsRoles) {
      const now = new Date().toISOString()
      const updates: Record<string, unknown> = { updated_at: now }

      if (needsName && auth.displayName) {
        const parts = auth.displayName.split(' ')
        updates.first_name = parts[0] || ''
        updates.last_name = parts.slice(1).join(' ') || ''
        updates.display_name = auth.displayName
      }

      if (needsRoles) {
        updates.system_roles = ['admin']
      }

      if (userDoc.exists) {
        await userRef.update(updates)
      } else {
        await userRef.set({ email: auth.email, created_at: now, ...updates })
      }
    }
  }

  return NextResponse.json({ approved })
}

// POST /api/approved-emails — admin-only: add an email to the approved list
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { email } = body

  if (!email?.trim()) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const normalizedEmail = email.trim().toLowerCase()
  await db.collection('approved_emails').doc(normalizedEmail).set({
    email: normalizedEmail,
    approved_by: auth.email,
    created_at: new Date().toISOString(),
  })

  return NextResponse.json({ email: normalizedEmail }, { status: 201 })
}
