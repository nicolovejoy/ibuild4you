import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import type { App } from '@/lib/types'
import { FieldValue } from 'firebase-admin/firestore'

type Ctx = { params: Promise<{ slug: string }> }

// GET /api/admin/apps/[slug] — one app by its canonical slug. Admin-only.
export async function GET(request: Request, { params }: Ctx) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { slug } = await params
  const doc = await getAdminDb().collection('apps').doc(slug).get()
  if (!doc.exists) return NextResponse.json({ error: 'App not found' }, { status: 404 })
  return NextResponse.json({ app: { id: doc.id, ...(doc.data() as Omit<App, 'id'>) } })
}

// PATCH /api/admin/apps/[slug] — only name, github_repo (empty string clears it)
// and feedback_requires_identity. Everything else (slug, legacy_slugs,
// created_by) is ignored.
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { slug } = await params
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    updates.name = body.name.trim()
  }
  if (body.github_repo !== undefined) {
    if (typeof body.github_repo !== 'string' || (body.github_repo !== '' && !/^[\w.-]+\/[\w.-]+$/.test(body.github_repo))) {
      return NextResponse.json({ error: 'github_repo must be owner/repo or empty' }, { status: 400 })
    }
    updates.github_repo = body.github_repo === '' ? FieldValue.delete() : body.github_repo
  }
  if (body.feedback_requires_identity !== undefined) {
    if (typeof body.feedback_requires_identity !== 'boolean') {
      return NextResponse.json({ error: 'feedback_requires_identity must be a boolean' }, { status: 400 })
    }
    updates.feedback_requires_identity = body.feedback_requires_identity
  }

  const ref = getAdminDb().collection('apps').doc(slug)
  if (!(await ref.get()).exists) return NextResponse.json({ error: 'App not found' }, { status: 404 })

  updates.updated_at = new Date().toISOString()
  await ref.update(updates)
  const doc = await ref.get()
  return NextResponse.json({ app: { id: doc.id, ...(doc.data() as Omit<App, 'id'>) } })
}
