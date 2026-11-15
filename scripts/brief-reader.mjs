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
// At start it fetches the datastore.viewer-only key from 1Password
// (dev-secrets / ibuild4you-firestore-ro), which costs one Touch ID per start.
// The reader runs in this launcher's own process (no child), so the key is
// never in any process's start-up environment, which other same-user processes
// can read with ps. It is set as FIREBASE_SERVICE_ACCOUNT at run time, and the
// reader removes it from the environment once its credential is built. The key
// is held in memory only: never written to disk, never printed. If
// FIREBASE_SERVICE_ACCOUNT_RO is already set, that is used and 1Password is not
// called; that variable is then visible in the launcher's environment, and that
// is the caller's choice.
//
// stdout belongs to the reader's protocol; this launcher only writes to stderr.
//
// Usage: node scripts/brief-reader.mjs --repo owner/name [--check]

import { execFileSync } from 'node:child_process'
import { ReaderKeyError, resolveReaderKey, safeToken } from './lib/reader-key.mjs'

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

// Run the reader in this process. A variable set now is not visible to ps.
process.env.FIREBASE_SERVICE_ACCOUNT = key
delete process.env.FIREBASE_SERVICE_ACCOUNT_RO

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
