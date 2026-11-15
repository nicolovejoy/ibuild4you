import { NextResponse } from 'next/server'
import { getAdminDb, getAuthenticatedUser, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import {
  fullRepo,
  getStatusKeyStatus,
  mintStatusKey,
  revokeStatusKey,
} from '@/lib/build-status/keys'

// =============================================================================
// GET | POST | DELETE /api/build-status/key?project_id=…
//
// Mint, inspect and revoke the build status key (bsk_…) for a project's repo.
// System admin only. The key belongs to the repo, not the project, so two
// briefs on one repo share it. Every response is no-store: the POST body
// carries the key, shown once. The key and its hash are never logged.
// =============================================================================

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Shared prelude: auth, system admin only, a project, and a full owner/name
// repo on it. Returns the uid and repo, or a response to send.
async function prelude(request: Request): Promise<{ uid: string; repo: string } | NextResponse> {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) return json({ error: 'Forbidden' }, 403)

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) return json({ error: 'project_id is required' }, 400)

  const doc = await getAdminDb().collection('projects').doc(projectId).get()
  if (!doc.exists) return json({ error: 'Project not found' }, 404)

  // The store does not re-validate the repo, so only a fullRepo() result goes in.
  const repo = fullRepo(doc.data()?.github_repo)
  if (!repo) return json({ error: 'needs_full_repo' }, 400)
  return { uid: auth.uid, repo }
}

// GET: whether a key exists and when it was made / last used. Never the key.
export async function GET(request: Request) {
  const pre = await prelude(request)
  if (pre instanceof NextResponse) return pre
  const status = await getStatusKeyStatus(getAdminDb(), pre.repo)
  return json({ repo: pre.repo, ...status })
}

// POST: mint a key, replacing any live one. The only place the key is returned.
export async function POST(request: Request) {
  const pre = await prelude(request)
  if (pre instanceof NextResponse) return pre
  const { key, created_at, rotated } = await mintStatusKey(getAdminDb(), pre.repo, pre.uid)
  console.log(JSON.stringify({ event: 'build_status_key_minted', repo: pre.repo, actor: pre.uid }))
  return json({ repo: pre.repo, key, created_at, rotated }, 201)
}

// DELETE: revoke the live key, if any.
export async function DELETE(request: Request) {
  const pre = await prelude(request)
  if (pre instanceof NextResponse) return pre
  const revoked = await revokeStatusKey(getAdminDb(), pre.repo)
  console.log(JSON.stringify({ event: 'build_status_key_revoked', repo: pre.repo, actor: pre.uid }))
  return json({ ok: true, revoked })
}
