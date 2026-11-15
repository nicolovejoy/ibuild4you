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

// The key goes out as a Bearer header, so only post where it cannot be read on
// the wire: any https base, or plain http to this machine (local dev), with an
// optional port. Anything else and the reader drops the key at start.
export function validStatusBase(base) {
  if (typeof base !== 'string') return false
  if (/^https:\/\/\S+$/i.test(base)) return true
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(base)
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
    return { ok: false, text: unreachable(networkDetail(err)) }
  }

  const status = res.status
  // Parsed once; null when the body is not JSON. Only `error` and `duplicate`
  // are ever read from it.
  let body = null
  try {
    body = JSON.parse(await res.text())
  } catch {
    // Not JSON (or the body never arrived): body stays null.
  }
  const error = typeof body?.error === 'string' ? body.error : null

  if (status === 201) return { ok: true, text: posted(slug) }
  if (status === 200) {
    if (body?.duplicate === true) {
      return { ok: true, text: 'Already posted (identical report a few minutes ago); nothing added.' }
    }
    // A 200 the reader cannot read (say, a proxy ate the body) still stored or
    // matched a report; whether it was a duplicate is unknown.
    if (body === null) return { ok: true, text: posted(slug) }
  }
  if (status === 401 || (status === 403 && error === null)) {
    return { ok: false, text: `The app refused the key for ${repo}. Give your report to Nico instead.` }
  }
  if (status === 403) {
    // The server's message ends with its own period; do not double it.
    const reason = error.replace(/\.+$/, '')
    return {
      ok: false,
      text: `The app refused this post: ${reason}. Check the slug with list_briefs. If it still fails, give your report to Nico instead.`,
    }
  }
  if (status === 429) {
    return { ok: false, text: `The app is holding too many unread reports for ${slug}. Give your report to Nico instead.` }
  }
  if (status === 400 && error !== null) {
    return { ok: false, text: `The report was refused: ${error}` }
  }
  return { ok: false, text: unreachable(safeToken(status) ?? 'no answer') }
}

const posted = (slug) => `Posted. The next prep for ${slug} will include it.`

// A short, safe word for a failed fetch, never the error's message. A timeout
// (AbortSignal.timeout's TimeoutError, or an AbortError) reads "timeout";
// otherwise the error's code, or Node fetch's err.cause.code, when it is a
// string (a DOMException's numeric code such as 23 means nothing to a reader);
// then the error's name.
function networkDetail(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout'
  const code = typeof err?.code === 'string' ? safeToken(err.code) : null
  const causeCode = typeof err?.cause?.code === 'string' ? safeToken(err.cause.code) : null
  return code ?? causeCode ?? safeToken(err?.name) ?? 'network error'
}
