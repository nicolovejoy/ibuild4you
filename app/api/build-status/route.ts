import { NextResponse, after } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { validateReport } from '@/lib/build-status/report'
import { fullRepo, verifyStatusKey, touchStatusKey } from '@/lib/build-status/keys'
import { addReport, listReports } from '@/lib/build-status/reports'
import { getAuthenticatedUser, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { reposMatch } from '@/lib/github/repo'
import type { BuildReport } from '@/lib/types'

// =============================================================================
// POST /api/build-status
//
// Claude Code in a build repo posts a status report (what is live, merged,
// proposed, and its open questions) with a per-repo key
// (`Authorization: Bearer bsk_…`). There is no Firebase user here, so this
// route does not call getAuthenticatedUser. Server-to-server only: no CORS
// headers and no OPTIONS handler.
//
// The key can add a report and nothing else. Order of checks is deliberate:
//   1. body is a JSON object                      -> 400
//   2. repo + key verify                          -> 401 (one message for every
//      failure: no key, malformed repo, no key doc for that repo, wrong key)
//   3. project exists and its github_repo matches -> 403 (one message for an
//      unknown slug and for a mismatch, so slugs cannot be probed)
//   4. brief_version_checked, then the report     -> 400
//   5. store it                                   -> 201, or 200 for a duplicate
//
// Nothing here logs or returns a key or its hash.
// =============================================================================

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function unauthorized() {
  return json({ error: 'Unauthorized' }, 401)
}

function forbidden() {
  return json({ error: 'This key cannot post to that project.' }, 403)
}

// Token from `Bearer <token>` (scheme case-insensitive), or null.
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^bearer\s+(.*)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return json({ error: 'Body must be a JSON object.' }, 400)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'Body must be a JSON object.' }, 400)
  }

  // The key store trusts its repo argument, so only a fullRepo() result goes in.
  const repo = typeof body.repo === 'string' ? fullRepo(body.repo) : null
  const token = bearerToken(request)
  if (!repo || !token) return unauthorized()

  const db = getAdminDb()
  const key = await verifyStatusKey(db, repo, token)
  if (!key) return unauthorized()

  // The key proves control of `repo`; the project must belong to that repo.
  const slug = typeof body.project === 'string' ? body.project.trim() : ''
  if (!slug) return forbidden()
  const projectSnap = await db.collection('projects').where('slug', '==', slug).limit(1).get()
  if (projectSnap.empty) return forbidden()
  const projectDoc = projectSnap.docs[0]
  const project = projectDoc.data() as { github_repo?: string }
  if (!reposMatch(project.github_repo, repo)) return forbidden()

  const version = body.brief_version_checked
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return json({ error: 'brief_version_checked must be a whole number.' }, 400)
  }

  const validated = validateReport(body)
  if (!validated.ok) return json({ error: validated.error }, 400)

  const { posted_at, duplicate } = await addReport(db, projectDoc.id, {
    repo,
    brief_version_checked: version,
    report: validated.report,
  })

  // after() keeps the invocation alive until the touch settles. It throws
  // outside a request scope (scripts); fall back to fire-and-forget there.
  const lastUsedAt = key.last_used_at
  try {
    after(() => touchStatusKey(db, repo, lastUsedAt))
  } catch {
    void touchStatusKey(db, repo, lastUsedAt)
  }
  console.log(JSON.stringify({ event: 'build_status_posted', repo, project: slug, duplicate }))

  if (duplicate) return json({ ok: true, posted_at, duplicate: true }, 200)
  return json({ ok: true, posted_at }, 201)
}

// =============================================================================
// GET /api/build-status?project_id=xxx
//
// A builder (or owner) reads the reports not yet folded into the brief, for
// the Brief tab's prep. Firebase auth only: a status key sent as the Bearer
// token fails token verification (401), so the key can never read.
//
// `latest_posted_at` is the newest report of any kind, folded or not, so the
// page can tell "nothing new" from "nothing ever posted". `body_hash` is an
// internal duplicate check and is not returned.
// =============================================================================
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) return json({ error: 'project_id is required' }, 400)

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  // One read, oldest first: the unfolded ones are filtered here, and the
  // newest of all is the last element.
  const all = await listReports(db, projectId)
  const reports = all
    .filter((r) => !r.folded_at)
    .map((r) => {
      const copy: Partial<BuildReport> = { ...r }
      delete copy.body_hash
      return copy
    })
  const latest_posted_at = all.length > 0 ? all[all.length - 1].posted_at : null

  return json({ reports, latest_posted_at })
}
