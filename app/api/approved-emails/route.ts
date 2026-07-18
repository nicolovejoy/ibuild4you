import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  hasSystemRole,
  isApprovedEmail,
} from '@/lib/api/firebase-server-helpers'
import { isAdminEmail } from '@/lib/constants'
import { normalizeEmail } from '@/lib/email/normalize'
import { scheduleGarmGrantSync } from '@/lib/garm-grants'

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
  const normalizedEmail = normalizeEmail(email)
  // Re-approving (e.g. after a revoke) must clear any prior revoke flag —
  // otherwise isApprovedEmail() would keep treating this doc as revoked.
  await db.collection('approved_emails').doc(normalizedEmail).set({
    email: normalizedEmail,
    approved_by: auth.email,
    created_at: new Date().toISOString(),
    revoked_at: null,
    revoked_by: null,
  })
  scheduleGarmGrantSync(normalizedEmail)

  return NextResponse.json({ email: normalizedEmail }, { status: 201 })
}

// DELETE /api/approved-emails — admin-only: revoke an email's sign-in
// approval (off-boarding). Non-destructive per house convention: sets
// revoked_at/revoked_by rather than deleting the doc. isApprovedEmail()
// treats a revoked row as not-approved; scheduleGarmGrantSync then lets
// computeGrantDecision emit a clean Garm revoke (no active memberships +
// not approved → revoke).
export async function DELETE(request: Request) {
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
  const normalizedEmail = normalizeEmail(email)
  const docRef = db.collection('approved_emails').doc(normalizedEmail)
  const doc = await docRef.get()

  if (!doc.exists) {
    return NextResponse.json({ error: 'No approved-email record for this address' }, { status: 404 })
  }
  if (doc.data()?.revoked_at) {
    return NextResponse.json({ error: 'This email has already been revoked' }, { status: 400 })
  }

  await docRef.update({
    revoked_at: new Date().toISOString(),
    revoked_by: auth.email,
  })
  scheduleGarmGrantSync(normalizedEmail)

  return NextResponse.json({ email: normalizedEmail, revoked: true })
}
