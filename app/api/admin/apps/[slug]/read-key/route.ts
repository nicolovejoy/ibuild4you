import { NextResponse } from 'next/server'
import { getAdminDb, getAuthenticatedUser, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { isValidAppSlug } from '@/lib/api/apps'
import { getReadKeyStatus, mintReadKey, revokeReadKey } from '@/lib/feedback/read-keys'

type Ctx = { params: Promise<{ slug: string }> }

// Every response here is no-store: the POST body carries the key, shown once.
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Shared prelude: auth, system admin only, a valid slug, and an app stored
// under exactly that (canonical) slug. Returns the uid or a response to send.
async function prelude(request: Request, slug: string): Promise<{ uid: string } | NextResponse> {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) return json({ error: 'Forbidden' }, 403)
  if (!isValidAppSlug(slug)) return json({ error: 'Invalid slug' }, 400)
  const doc = await getAdminDb().collection('apps').doc(slug).get()
  if (!doc.exists) return json({ error: 'App not found' }, 404)
  return { uid: auth.uid }
}

// GET — whether a key exists and when it was made / last used. Never the key.
export async function GET(request: Request, { params }: Ctx) {
  const { slug } = await params
  const pre = await prelude(request, slug)
  if (pre instanceof NextResponse) return pre
  return json(await getReadKeyStatus(getAdminDb(), slug))
}

// POST — mint a key, replacing any live one (that is Rotate). The only place
// the key is ever returned.
export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params
  const pre = await prelude(request, slug)
  if (pre instanceof NextResponse) return pre
  const { key, created_at, rotated } = await mintReadKey(getAdminDb(), slug, pre.uid)
  console.log(JSON.stringify({ event: 'loop_read_key_minted', slug, actor: pre.uid, rotated }))
  return json({ key, created_at, rotated }, 201)
}

// DELETE — revoke the live key, if any.
export async function DELETE(request: Request, { params }: Ctx) {
  const { slug } = await params
  const pre = await prelude(request, slug)
  if (pre instanceof NextResponse) return pre
  const revoked = await revokeReadKey(getAdminDb(), slug)
  console.log(JSON.stringify({ event: 'loop_read_key_revoked', slug, actor: pre.uid }))
  return json({ ok: true, revoked })
}
