import { NextResponse } from 'next/server'
import { copy } from '@/lib/copy'

// POST /api/auth/passcode — RETIRED (Garm consumer plan PR D).
//
// Passcode sign-in is gone: makers sign in with Google or email+password
// ("Forgot password?" on the login page sets one). The route is kept so a
// stale login page or old client gets a clear 410 Gone instead of a 404,
// and it deliberately reads nothing — no body validation, no Firestore
// lookup, no token minting.
export async function POST(_request: Request) {
  return NextResponse.json({ error: copy.auth.passcodeRetired }, { status: 410 })
}
