import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  requireAdmin,
  isApprovedEmail,
} from '@/lib/api/firebase-server-helpers'

// GET /api/approved-emails — check if the current user's email is approved
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const approved = await isApprovedEmail(auth.email)
  return NextResponse.json({ approved })
}

// POST /api/approved-emails — admin-only: add an email to the approved list
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const adminCheck = requireAdmin(auth.email)
  if (adminCheck) return adminCheck

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
