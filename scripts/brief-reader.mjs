#!/usr/bin/env node
// Launcher for the read-only brief reader (scripts/mcp-briefs.mjs). A build
// repo registers THIS script, not the reader, so its Claude Code sessions can
// read a project's brief, notes and transcripts. In the build repo's .mcp.json:
//
//   {
//     "mcpServers": {
//       "ibuild-briefs": {
//         "command": "node",
//         "args": ["/Users/nico/src/ibuild4you/scripts/brief-reader.mjs", "--repo", "owner/name"]
//       }
//     }
//   }
//
// At start it makes two 1Password fetches (expect a Touch ID prompt):
//   1. the datastore.viewer-only key (document dev-secrets /
//      ibuild4you-firestore-ro). Required: without it the reader does not start.
//   2. this repo's build status key (item dev-secrets /
//      ibuild4you-build-status-<owner>-<name>, field password), which lets the
//      post_build_status tool add a report and nothing else. Optional: if it is
//      not minted or 1Password does not answer, one stderr line says so and the
//      reader starts without it (the tool then tells the agent to hand the
//      report to Nico).
// The reader runs in this launcher's own process (no child), so neither key is
// ever in any process's start-up environment, which other same-user processes
// can read with ps. They are set at run time, as FIREBASE_SERVICE_ACCOUNT and
// BUILD_STATUS_KEY (or BUILD_STATUS_KEY_REASON when there is no status key),
// and the reader removes them from the environment once it has read them. Keys
// are held in memory only: never written to disk, never printed. If
// FIREBASE_SERVICE_ACCOUNT_RO or BUILD_STATUS_KEY is already set, that is used
// and that fetch is skipped; the variable is then visible in the launcher's
// environment, and that is the caller's choice.
//
// stdout belongs to the reader's protocol; this launcher only writes to stderr.
//
// Usage: node scripts/brief-reader.mjs --repo owner/name [--check]

import { execFileSync } from 'node:child_process'
import { ReaderKeyError, resolveReaderKey, safeToken } from './lib/reader-key.mjs'
import { noKeyMessage, resolveStatusKey, statusKeyItem } from './lib/build-status-post.mjs'

const args = process.argv.slice(2)

// A bad registration should fail before the key fetch, so it never costs a
// Touch ID.
const repoIdx = args.indexOf('--repo')
const repo = repoIdx >= 0 ? args[repoIdx + 1] : undefined
if (!repo || repo.startsWith('--')) {
  console.error('Usage: node scripts/brief-reader.mjs --repo owner/name [--check]')
  process.exit(1)
}

const fetchFromOnePassword = () =>
  execFileSync('op', ['document', 'get', 'ibuild4you-firestore-ro', '--vault', 'dev-secrets'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })

let key
try {
  ;({ key } = resolveReaderKey({ env: process.env, fetchFromOnePassword }))
} catch (err) {
  // Plain line only: no stack, and nothing from the error beyond our own message.
  console.error(
    err instanceof ReaderKeyError
      ? `brief-reader: ${err.message}`
      : 'brief-reader: unexpected failure starting the reader.'
  )
  process.exit(1)
}

// The status key is optional, so its fetch can only ever produce a reason,
// never stop the start. resolveStatusKey does not throw; the try is a
// backstop so nothing unexpected here can either.
const fetchStatusKeyFromOnePassword = () =>
  execFileSync('op', ['read', 'op://dev-secrets/' + statusKeyItem(repo) + '/password'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  })

let statusKey = null
let statusKeyReason = null
try {
  const resolved = resolveStatusKey({ env: process.env, repo, fetchFromOnePassword: fetchStatusKeyFromOnePassword })
  statusKey = resolved.key
  statusKeyReason = resolved.reason ?? null
} catch {
  statusKeyReason = '1Password did not answer'
}

// Run the reader in this process. A variable set now is not visible to ps.
process.env.FIREBASE_SERVICE_ACCOUNT = key
delete process.env.FIREBASE_SERVICE_ACCOUNT_RO
if (statusKey) {
  process.env.BUILD_STATUS_KEY = statusKey
  delete process.env.BUILD_STATUS_KEY_REASON
} else {
  // Our reason is a fixed phrase, never 1Password's output.
  delete process.env.BUILD_STATUS_KEY
  process.env.BUILD_STATUS_KEY_REASON = statusKeyReason
  console.error(`brief-reader: ${noKeyMessage(repo, statusKeyReason)}`)
}

try {
  // mcp-briefs.mjs reads process.argv.slice(2), the same here, and resolves its
  // own imports from its own location. Its top-level await keeps this open
  // while serving; --check finishes and exits inside it.
  await import(new URL('./mcp-briefs.mjs', import.meta.url).href)
} catch (err) {
  // One plain line. Only a safe code or name from the error, never its
  // message, stack or the object itself: a Firestore auth failure can quote
  // parts of the credential.
  const detail = safeToken(err?.code) ?? safeToken(err?.name) ?? 'unknown error'
  console.error(`brief-reader: the reader failed to start (${detail}).`)
  process.exit(1)
}
