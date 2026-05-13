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
  })
  if (process.env.NODE_ENV !== 'production') {
    res.headers.set('X-Cache', auth.cacheStatus)
  }
  return res
}

// PATCH /api/users/me — update the current user's name
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { first_name, last_name } = body

  if (typeof first_name !== 'string') {
    return NextResponse.json({ error: 'first_name is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  // Upsert the users doc (passcode users may not have one yet)
  const userRef = db.collection('users').doc(auth.uid)
  const userDoc = await userRef.get()
  if (userDoc.exists) {
    await userRef.update({
      first_name: first_name.trim(),
      last_name: typeof last_name === 'string' ? last_name.trim() : '',
      updated_at: now,
    })
  } else {
    await userRef.set({
      email: auth.email,
      first_name: first_name.trim(),
      last_name: typeof last_name === 'string' ? last_name.trim() : '',
      created_at: now,
      updated_at: now,
    })
  }

  // Sync requester name cache on any projects where this user is the requester
  const projectsAsRequester = await db
    .collection('projects')
    .where('requester_email', '==', auth.email)
    .get()

  if (!projectsAsRequester.empty) {
    const batch = db.batch()
    for (const doc of projectsAsRequester.docs) {
      batch.update(doc.ref, {
        requester_first_name: first_name.trim(),
        requester_last_name: typeof last_name === 'string' ? last_name.trim() : '',
        updated_at: now,
      })
    }
    await batch.commit()
  }

  // Bust the auth cache so the next request sees the new name.
  invalidateUser(auth.uid)

  return NextResponse.json({
    uid: auth.uid,
    email: auth.email,
    system_roles: auth.systemRoles,
    first_name: first_name.trim(),
    last_name: typeof last_name === 'string' ? last_name.trim() : '',
  })
}
