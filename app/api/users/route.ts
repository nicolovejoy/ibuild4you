import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, isAdminEmail } from '@/lib/api/firebase-server-helpers'

// GET /api/users — admin-only: list all users
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!isAdminEmail(auth.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getAdminDb()
  const snap = await db.collection('users').orderBy('email').get()
  const users = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

  return NextResponse.json(users)
}

// PATCH /api/users — admin-only: update a user's name
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!isAdminEmail(auth.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, first_name, last_name } = body

  if (!user_id) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const userRef = db.collection('users').doc(user_id)
  const userDoc = await userRef.get()

  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const updates: Record<string, string> = { updated_at: new Date().toISOString() }
  if (first_name !== undefined) updates.first_name = first_name
  if (last_name !== undefined) updates.last_name = last_name

  await userRef.update(updates)

  const updated = (await userRef.get()).data()
  return NextResponse.json({ id: user_id, ...updated })
}
