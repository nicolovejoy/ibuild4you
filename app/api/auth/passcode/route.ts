import { NextResponse } from 'next/server'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
// POST /api/auth/passcode — verify email + passcode, return custom token
export async function POST(request: Request) {
  const body = await request.json()
  const { email, passcode } = body

  if (!email?.trim() || !passcode?.trim()) {
    return NextResponse.json(
      { error: 'Email and passcode are required' },
      { status: 400 }
    )
  }

  const normalizedEmail = email.trim().toLowerCase()
  const normalizedPasscode = passcode.trim().toUpperCase()

  const db = getAdminDb()

  // Find a project_members doc matching this email and passcode
  const memberSnap = await db
    .collection('project_members')
    .where('email', '==', normalizedEmail)
    .where('passcode', '==', normalizedPasscode)
    .limit(1)
    .get()

  if (memberSnap.empty) {
    return NextResponse.json(
      { error: 'Invalid email or passcode' },
      { status: 401 }
    )
  }

  // Get or create Firebase Auth user for this email
  const adminAuth = getAdminAuth()
  let uid: string

  try {
    const existingUser = await adminAuth.getUserByEmail(normalizedEmail)
    uid = existingUser.uid
  } catch {
    // User doesn't exist in Firebase Auth — create them
    const newUser = await adminAuth.createUser({ email: normalizedEmail })
    uid = newUser.uid
  }

  // Generate custom token for client-side sign-in
  const token = await adminAuth.createCustomToken(uid)

  return NextResponse.json({ token })
}
