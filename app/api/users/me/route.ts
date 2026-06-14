import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb } from '@/lib/api/firebase-server-helpers'
import { invalidateUser } from '@/lib/api/auth-cache'

// GET /api/users/me — return the current user's profile and system roles.
// User doc data is read by getAuthenticatedUser and reused here (no second read).
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const res = NextResponse.json({
    uid: auth.uid,
    email: auth.email,
    system_roles: auth.systemRoles,
    first_name: auth.userData?.first_name ?? null,
    last_name: auth.userData?.last_name ?? null,
    account_label: auth.userData?.account_label ?? null,
  })
  if (process.env.NODE_ENV !== 'production') {
    res.headers.set('X-Cache', auth.cacheStatus)
  }
  return res
}

// PATCH /api/users/me — partial update of the caller's profile.
// Accepts any subset of { first_name, last_name, account_label }. A name edit
// requires first_name (last_name rides along); account_label can be set alone
// (a self-assigned nav label like "main" / "test account"). Empty string clears
// the label.
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { first_name, last_name, account_label } = body

  const hasName = first_name !== undefined
  const hasLabel = account_label !== undefined

  if (hasName && typeof first_name !== 'string') {
    return NextResponse.json({ error: 'first_name must be a string' }, { status: 400 })
  }
  if (hasLabel && typeof account_label !== 'string') {
    return NextResponse.json({ error: 'account_label must be a string' }, { status: 400 })
  }
  if (!hasName && !hasLabel) {
    return NextResponse.json(
      { error: 'first_name or account_label is required' },
      { status: 400 }
    )
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  // Build the partial update from whichever fields were provided.
  const fields: Record<string, string> = { updated_at: now }
  if (hasName) {
    fields.first_name = first_name.trim()
    fields.last_name = typeof last_name === 'string' ? last_name.trim() : ''
  }
  if (hasLabel) {
    fields.account_label = account_label.trim()
  }

  // Upsert the users doc (passcode users may not have one yet)
  const userRef = db.collection('users').doc(auth.uid)
  const userDoc = await userRef.get()
  if (userDoc.exists) {
    await userRef.update(fields)
  } else {
    await userRef.set({ email: auth.email, created_at: now, ...fields })
  }

  // Sync requester name cache on any projects where this user is the requester.
  // Only relevant to name edits — a label-only change touches no project.
  if (hasName) {
    const projectsAsRequester = await db
      .collection('projects')
      .where('requester_email', '==', auth.email)
      .get()

    if (!projectsAsRequester.empty) {
      const batch = db.batch()
      for (const doc of projectsAsRequester.docs) {
        batch.update(doc.ref, {
          requester_first_name: fields.first_name,
          requester_last_name: fields.last_name,
          updated_at: now,
        })
      }
      await batch.commit()
    }
  }

  // Bust the auth cache so the next request sees the new values.
  invalidateUser(auth.uid)

  return NextResponse.json({
    uid: auth.uid,
    email: auth.email,
    system_roles: auth.systemRoles,
    first_name: auth.userData?.first_name ?? null,
    last_name: auth.userData?.last_name ?? null,
    account_label: auth.userData?.account_label ?? null,
    ...(hasName ? { first_name: fields.first_name, last_name: fields.last_name } : {}),
    ...(hasLabel ? { account_label: fields.account_label } : {}),
  })
}
