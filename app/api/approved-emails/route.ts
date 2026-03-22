import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  isAdminEmail,
  isApprovedEmail,
} from '@/lib/api/firebase-server-helpers'

// GET /api/approved-emails — check if the current user's email is approved
// Also upserts the user doc with names from the auth token (Google sign-in)
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const approved = await isApprovedEmail(auth.email)

  // Upsert user doc with name from auth provider (fire-and-forget)
  if (approved && auth.displayName) {
    const db = getAdminDb()
    const userRef = db.collection('users').doc(auth.uid)
    const userDoc = await userRef.get()
    if (!userDoc.exists || !userDoc.data()?.first_name) {
      const parts = auth.displayName.split(' ')
      const firstName = parts[0] || ''
      const lastName = parts.slice(1).join(' ') || ''
      const now = new Date().toISOString()
      if (userDoc.exists) {
        await userRef.update({ first_name: firstName, last_name: lastName, display_name: auth.displayName, updated_at: now })
      } else {
        await userRef.set({ email: auth.email, first_name: firstName, last_name: lastName, display_name: auth.displayName, created_at: now, updated_at: now })
      }
    }
  }

  return NextResponse.json({ approved })
}

// POST /api/approved-emails — admin-only: add an email to the approved list
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!isAdminEmail(auth.email)) {
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
