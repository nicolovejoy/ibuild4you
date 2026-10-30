import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { createApp, isSlugTaken, isValidAppSlug, AppSlugInvalid, AppSlugTaken } from '@/lib/api/apps'
import { accessibleApps } from '@/lib/api/app-access'
import {
  createGarmApp,
  GarmLoopError,
  loopGarmBypassed,
  loopGarmConfigured,
} from '@/lib/garm-loop'

// GET /api/admin/apps — the Loop apps the caller can see, sorted by name, each
// with their `access`. Admins see all; others only apps Garm grants them ([] if none).
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const rows = await accessibleApps(auth)
  return NextResponse.json({ apps: rows.map(({ app, access }) => ({ ...app, access })) })
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

  if (!isValidAppSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }
  // Cheap local check first, so a taken slug never reaches Garm.
  if (await isSlugTaken(getAdminDb(), slug)) {
    return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
  }

  // Garm app first: it is the authority for who may use the app. Nothing is
  // written locally if Garm refuses. A preview with no Loop key skips this step.
  if (!loopGarmBypassed()) {
    if (!loopGarmConfigured()) {
      return NextResponse.json({ error: 'Garm is not configured' }, { status: 503 })
    }
    try {
      await createGarmApp(auth.email, slug, name.trim())
    } catch (err) {
      const status = err instanceof GarmLoopError ? err.status : null
      if (status === 409) {
        return NextResponse.json({ error: 'That slug already exists in Garm' }, { status: 409 })
      }
      if (status === 403) {
        return NextResponse.json(
          { error: 'You are not an owner of garm, so you cannot create apps' },
          { status: 403 }
        )
      }
      return NextResponse.json({ error: 'Garm is unavailable' }, { status: 502 })
    }
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
    // Garm apps are never deleted. A retry of the create will 409 in Garm; the
    // admin fixes the local row by hand.
    console.error('[apps] garm app created but local row failed', { slug })
    throw err
  }
}
