// The brief reader's one write: post a build status report to the app
// (POST /api/build-status) with the repo's own status key. Used by the
// launcher (scripts/brief-reader.mjs, to resolve the key) and the reader
// (scripts/mcp-briefs.mjs, the post_build_status tool).
// Pure: no I/O of its own, no child_process, no process.env (the caller passes
// env, fetch and the 1Password call), so it is tested without 1Password or a
// network.
//
// The status key can only add a report, but it is still a credential. Nothing
// here may put it, or any of 1Password's output, into a returned text. Every
// text is one plain line, safe to print or hand to the calling agent.

import { normalizeRepo } from './brief-markdown.mjs'
import { safeToken } from './reader-key.mjs'

// The 1Password item holding a repo's key, in the dev-secrets vault:
// nicolovejoy/l6-music -> ibuild4you-build-status-nicolovejoy-l6-music
export const statusKeyItem = (repo) => `ibuild4you-build-status-${normalizeRepo(repo).replace(/\//g, '-')}`

const KEY_SHAPE = /^bsk_[A-Za-z0-9_-]{10,}$/

// env.BUILD_STATUS_KEY wins when set; otherwise fetchFromOnePassword() supplies
// it. Never throws: a missing key is normal (not every repo has one minted), so
// every failure becomes a short reason and the reader still starts. Callers
// also pass `repo`; fetchFromOnePassword already knows which item to read.
export function resolveStatusKey({ env, fetchFromOnePassword }) {
  const fromEnv = env?.BUILD_STATUS_KEY
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { key: fromEnv.trim() }
  }

  let text
  try {
    text = fetchFromOnePassword()
  } catch (err) {
    // stderr is only matched here, never returned: it is 1Password's output.
    const stderr = String(err?.stderr ?? '')
    const reason = /isn't an item|no item|not found/i.test(stderr) ? 'not minted' : '1Password did not answer'
    return { key: null, reason }
  }

  const key = typeof text === 'string' ? text.trim() : ''
  if (!KEY_SHAPE.test(key)) return { key: null, reason: 'the stored key is not a build status key' }
  return { key }
}

export const noKeyMessage = (repo, reason) =>
  `No build status key for ${repo} (${reason}). Give your report to Nico instead.`

const unreachable = (detail) => `Could not reach the app (${detail}). Give your report to Nico instead.`

// POST the report. Resolves to { ok, text } and never throws. The server is the
// authority on limits: its 400 message is passed through so the agent can fix
// the report and post again.
export async function postBuildStatus({ fetch, base, key, repo, slug, briefVersion, report }) {
  const { ok, text } = await postAndDescribe({ fetch, base, key, repo, slug, briefVersion, report })
  // Belt and braces: no text leaves here with the key in it, even if a server
  // message ever quoted it.
  return { ok, text: key ? text.split(key).join('[key]') : text }
}

async function postAndDescribe({ fetch, base, key, repo, slug, briefVersion, report }) {
  let res
  try {
    res = await fetch(`${String(base).replace(/\/+$/, '')}/api/build-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: normalizeRepo(repo), project: slug, brief_version_checked: briefVersion, ...report }),
      // A tool call must not hang the session if the app never answers.
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    // Only a safe code or name, never the error's message: Node's fetch puts
    // the real code on err.cause.
    const detail = safeToken(err?.code) ?? safeToken(err?.cause?.code) ?? safeToken(err?.name) ?? 'network error'
    return { ok: false, text: unreachable(detail) }
  }

  const status = res.status
  if (status === 401 || status === 403) {
    return { ok: false, text: `The app refused the key for ${repo}. Give your report to Nico instead.` }
  }

  let body
  try {
    body = JSON.parse(await res.text())
  } catch {
    return { ok: false, text: unreachable(safeToken(status) ?? 'no answer') }
  }

  if (status === 201) {
    return { ok: true, text: `Posted. The next prep for ${slug} will include it.` }
  }
  if (status === 200 && body?.duplicate === true) {
    return { ok: true, text: 'Already posted (identical report a few minutes ago); nothing added.' }
  }
  if (status === 400 && typeof body?.error === 'string') {
    return { ok: false, text: `The report was refused: ${body.error}` }
  }
  return { ok: false, text: unreachable(safeToken(status) ?? 'no answer') }
}
