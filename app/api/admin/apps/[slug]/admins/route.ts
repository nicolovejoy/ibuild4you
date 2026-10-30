import { NextResponse } from 'next/server'
import { getAdminDb, getAuthenticatedUser } from '@/lib/api/firebase-server-helpers'
import { requireAppAccess } from '@/lib/api/app-access'
import { findAppBySlug, isValidAppSlug } from '@/lib/api/apps'
import {
  GarmLoopError,
  grantOnApp,
  listAppGrants,
  loopGarmBypassed,
  loopGarmConfigured,
  revokeOnApp,
} from '@/lib/garm-loop'
import { isValidEmail, normalizeEmail } from '@/lib/email/normalize'

type Ctx = { params: Promise<{ slug: string }> }

// An app's admins live in Garm and nowhere else: this route stores nothing and
// every response is no-store so no proxy keeps a copy either.
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Wrap a gate response (403 etc.) so it also carries no-store.
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function garmError(err: unknown) {
  const status = err instanceof GarmLoopError ? err.status : null
  if (status === 404) return json({ error: 'App not found in Garm' }, 404)
  if (status === 403) return json({ error: 'Garm says you are not an owner of this app' }, 403)
  if (status === 409) {
    // Garm sends two distinct 409s; only one of them is the last-owner guardrail.
    const code = err instanceof GarmLoopError ? err.code : null
    if (code === 'last_owner') return json({ error: 'last_owner' }, 409)
    if (code === 'alias') return json({ error: 'alias' }, 409)
    return json({ error: 'Garm rejected the request' }, 409)
  }
  if (status === 400) return json({ error: 'Garm rejected the request' }, 400)
  return json({ error: 'Garm is unavailable' }, 502)
}

// Shared prelude: auth, a valid slug naming a known app (a legacy slug resolves
// to its canonical one), owner gate on the canonical slug (system admins pass),
// then Garm must be usable. Returns the actor email and canonical slug, or a
// response to send back.
async function prelude(
  request: Request,
  rawSlug: string
): Promise<{ actor: string; slug: string } | NextResponse> {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return noStore(auth.error)
  if (!isValidAppSlug(rawSlug)) return json({ error: 'Invalid slug' }, 400)
  const app = await findAppBySlug(getAdminDb(), rawSlug)
  if (!app) return json({ error: 'App not found' }, 404)
  const denied = await requireAppAccess(auth, app.slug, 'owner')
  if (denied) return noStore(denied)
  if (loopGarmBypassed() || !loopGarmConfigured()) {
    return json({ error: 'Garm is not configured' }, 503)
  }
  return { actor: auth.email, slug: app.slug }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// GET /api/admin/apps/[slug]/admins — everything Garm lists for the app.
export async function GET(request: Request, { params }: Ctx) {
  const { slug } = await params
  const pre = await prelude(request, slug)
  if (pre instanceof NextResponse) return pre
  try {
    return json({ admins: await listAppGrants(pre.slug) })
  } catch (err) {
    return garmError(err)
  }
}

// POST { email, role } — grant owner or collaborator.
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const pre = await prelude(request, slug)
  if (pre instanceof NextResponse) return pre
  const body = await readBody(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const { email, role } = body
  if (typeof email !== 'string' || !isValidEmail(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }
  if (role !== 'owner' && role !== 'collaborator') {
    return json({ error: 'role must be owner or collaborator' }, 400)
  }
  try {
    await grantOnApp(pre.actor, pre.slug, normalizeEmail(email), role)
    return json({ ok: true })
  } catch (err) {
    return garmError(err)
  }
}

// DELETE { email } — revoke that person's grant.
export async function DELETE(request: Request, { params }: Ctx) {
  const { slug } = await params
  const pre = await prelude(request, slug)
  if (pre instanceof NextResponse) return pre
  const body = await readBody(request)
  if (!body) return json({ error: 'Invalid JSON' }, 400)
  const { email } = body
  if (typeof email !== 'string' || !isValidEmail(email)) {
    return json({ error: 'A valid email is required' }, 400)
  }
  try {
    await revokeOnApp(pre.actor, pre.slug, normalizeEmail(email))
    return json({ ok: true })
  } catch (err) {
    return garmError(err)
  }
}
