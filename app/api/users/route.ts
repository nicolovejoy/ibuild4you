import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { getAdminAuth } from '@/lib/firebase/admin'

// GET /api/users — admin-only: list all known people
// Merges users collection, project_members, and approved_emails
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getAdminDb()

  // Get all users docs
  const usersSnap = await db.collection('users').get()
  const usersMap = new Map<string, Record<string, unknown>>()
  for (const doc of usersSnap.docs) {
    const data = doc.data()
    const email = (data.email as string)?.toLowerCase()
    if (email) {
      usersMap.set(email, { id: doc.id, ...data, source: 'users' })
    }
  }

  // Get all project members (find people without users docs)
  const membersSnap = await db.collection('project_members').get()
  for (const doc of membersSnap.docs) {
    const data = doc.data()
    const email = (data.email as string)?.toLowerCase()
    if (email && !usersMap.has(email)) {
      usersMap.set(email, {
        id: data.user_id || `pm:${doc.id}`,
        email,
        first_name: data.first_name || null,
        last_name: data.last_name || null,
        role: data.role,
        source: 'project_member',
        has_users_doc: false,
      })
    }
  }

  // Get approved emails not yet in the map
  const approvedSnap = await db.collection('approved_emails').get()
  for (const doc of approvedSnap.docs) {
    const email = doc.id.toLowerCase()
    if (!usersMap.has(email)) {
      usersMap.set(email, {
        id: `ae:${email}`,
        email,
        first_name: null,
        last_name: null,
        source: 'approved_only',
        has_users_doc: false,
      })
    }
  }

  // Sort: missing names first, then alphabetical by email
  const users = Array.from(usersMap.values()).sort((a, b) => {
    const aHasName = !!a.first_name
    const bHasName = !!b.first_name
    if (aHasName !== bHasName) return aHasName ? 1 : -1
    return ((a.email as string) || '').localeCompare((b.email as string) || '')
  })

  return NextResponse.json(users)
}

// PATCH /api/users — admin-only: update a user's name
// Creates a users doc if one doesn't exist yet (for passcode-only users)
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, email, first_name, last_name } = body

  if (!user_id && !email) {
    return NextResponse.json({ error: 'user_id or email is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  // If we have a real user_id (Firebase UID), update or create the doc
  if (user_id && !user_id.startsWith('pm:') && !user_id.startsWith('ae:')) {
    const userRef = db.collection('users').doc(user_id)
    const userDoc = await userRef.get()

    if (userDoc.exists) {
      const updates: Record<string, string> = { updated_at: now }
      if (first_name !== undefined) updates.first_name = first_name
      if (last_name !== undefined) updates.last_name = last_name
      await userRef.update(updates)
    } else {
      await userRef.set({
        email: email || '',
        first_name: first_name || '',
        last_name: last_name || '',
        created_at: now,
        updated_at: now,
      })
    }

    const updated = (await userRef.get()).data()
    return NextResponse.json({ id: user_id, ...updated })
  }

  // For users without a real UID, look up by email
  // They might have a Firebase Auth user from passcode login
  const targetEmail = email || ''
  if (!targetEmail) {
    return NextResponse.json({ error: 'Email required for this user' }, { status: 400 })
  }

  // Check if they have a Firebase Auth account
  let uid: string | null = null
  try {
    const fbUser = await getAdminAuth().getUserByEmail(targetEmail)
    uid = fbUser.uid
  } catch {
    // No Firebase Auth user — create a users doc keyed by email
  }

  const docId = uid || targetEmail.replace(/[^a-zA-Z0-9]/g, '_')
  const userRef = db.collection('users').doc(docId)
  const userDoc = await userRef.get()

  if (userDoc.exists) {
    const updates: Record<string, string> = { updated_at: now }
    if (first_name !== undefined) updates.first_name = first_name
    if (last_name !== undefined) updates.last_name = last_name
    await userRef.update(updates)
  } else {
    await userRef.set({
      email: targetEmail,
      first_name: first_name || '',
      last_name: last_name || '',
      created_at: now,
      updated_at: now,
    })
  }

  // Also update project_members with this email so getUserDisplayName works
  // until we fully migrate to users-only names
  const memberSnap = await db.collection('project_members')
    .where('email', '==', targetEmail)
    .get()
  for (const doc of memberSnap.docs) {
    await doc.ref.update({
      ...(uid && { user_id: uid }),
      updated_at: now,
    })
  }

  const updated = (await userRef.get()).data()
  return NextResponse.json({ id: docId, ...updated })
}
