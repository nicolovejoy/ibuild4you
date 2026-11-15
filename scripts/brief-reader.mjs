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
// (dev-secrets / ibuild4you-firestore-ro), which costs one Touch ID per start,
// and hands it to the reader through the FIREBASE_SERVICE_ACCOUNT variable of
// the child process. The key is held in memory only: never written to disk,
// never printed. If FIREBASE_SERVICE_ACCOUNT_RO is already set, that is used
// and 1Password is not called.
//
// stdout belongs to the reader's protocol; this launcher only writes to stderr.
//
// Usage: node scripts/brief-reader.mjs --repo owner/name [--check]

import { execFileSync, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReaderKeyError, resolveReaderKey } from './lib/reader-key.mjs'

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

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const env = { ...process.env, FIREBASE_SERVICE_ACCOUNT: key }
delete env.FIREBASE_SERVICE_ACCOUNT_RO

const child = spawn(process.execPath, [join(scriptsDir, 'mcp-briefs.mjs'), ...args], {
  cwd: dirname(scriptsDir), // the repo root, whatever directory we were started from
  env,
  stdio: 'inherit',
})
child.on('error', () => {
  console.error('brief-reader: could not start the reader.')
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
