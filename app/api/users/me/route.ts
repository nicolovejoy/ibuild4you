import { NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/api/firebase-server-helpers'

// GET /api/users/me — return the current user's system roles
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  return NextResponse.json({
    uid: auth.uid,
    email: auth.email,
    system_roles: auth.systemRoles,
  })
}
