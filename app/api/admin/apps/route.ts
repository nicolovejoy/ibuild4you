import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { createApp, AppSlugInvalid, AppSlugTaken } from '@/lib/api/apps'
import type { App } from '@/lib/types'

// GET /api/admin/apps — list Loop apps, sorted by name. Admin-only.
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const snap = await getAdminDb().collection('apps').get()
  const apps: App[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<App, 'id'>) }))
  apps.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ apps })
}

// POST /api/admin/apps { slug, name, github_repo?, feedback_requires_identity? }
// The slug is validated exactly as typed: no trim/lowercase, so an admin never
// gets a different slug than the one they entered.
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { slug, name, github_repo, feedback_requires_identity } = body
  if (typeof slug !== 'string') {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (github_repo !== undefined && (typeof github_repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(github_repo))) {
    return NextResponse.json({ error: 'github_repo must be owner/repo' }, { status: 400 })
  }
  if (feedback_requires_identity !== undefined && typeof feedback_requires_identity !== 'boolean') {
    return NextResponse.json({ error: 'feedback_requires_identity must be a boolean' }, { status: 400 })
  }

  try {
    const app = await createApp(getAdminDb(), {
      slug,
      name: name.trim(),
      created_by: auth.email,
      ...(github_repo ? { github_repo: github_repo as string } : {}),
      ...(feedback_requires_identity !== undefined
        ? { feedback_requires_identity: feedback_requires_identity as boolean }
        : {}),
    })
    return NextResponse.json({ app }, { status: 201 })
  } catch (err) {
    if (err instanceof AppSlugInvalid) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    if (err instanceof AppSlugTaken) return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    throw err
  }
}
