#!/usr/bin/env node
// Read-ONLY variant of with-prod-env.mjs. Loads .env.local but maps the
// read-only service-account key (FIREBASE_SERVICE_ACCOUNT_RO) into
// FIREBASE_SERVICE_ACCOUNT for the child process, so any script run through
// this wrapper authenticates with a datastore.viewer-only credential —
// Firestore physically rejects writes. Use this for prod inspection scripts.
//
// FIREBASE_SERVICE_ACCOUNT_RO must be a service account with ONLY
// roles/datastore.viewer on ibuild4you-a0c4d (no write/delete). Store it in
// .env.local (+ 1Password dev-secrets). If it's absent, this wrapper refuses
// to run rather than silently falling back to the full-access key.
//
// Safe to commit: this file contains no secrets.
//
// Usage:
//   node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs --grep prntd

import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const ENV_FILE = '.env.local'
if (!existsSync(ENV_FILE)) {
  console.error(`ERROR: ${ENV_FILE} not found in ${process.cwd()}`)
  process.exit(1)
}

const env = { ...process.env }
const content = readFileSync(ENV_FILE, 'utf8')

// Minimal .env parser: KEY=VALUE per line, comments with #, optional surrounding
// quotes. Same shape as with-prod-env.mjs.
for (const rawLine of content.split('\n')) {
  const line = rawLine.replace(/\r$/, '')
  if (!line.trim() || line.trim().startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq < 0) continue
  const key = line.slice(0, eq).trim()
  let value = line.slice(eq + 1)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  env[key] = value
}

// Require the read-only key. Refuse to run on the full-access key — the whole
// point of this wrapper is that it cannot write.
if (!env.FIREBASE_SERVICE_ACCOUNT_RO) {
  console.error(
    'ERROR: FIREBASE_SERVICE_ACCOUNT_RO not set in .env.local.\n' +
      'Create a datastore.viewer-only service account on ibuild4you-a0c4d and add its\n' +
      'JSON key as FIREBASE_SERVICE_ACCOUNT_RO. This wrapper will not fall back to the\n' +
      'full-access key.'
  )
  process.exit(1)
}
// Map the RO key into the slot the Admin SDK reads, and drop the full-access
// key from the child env entirely so nothing can reach for it.
env.FIREBASE_SERVICE_ACCOUNT = env.FIREBASE_SERVICE_ACCOUNT_RO
delete env.FIREBASE_SERVICE_ACCOUNT_RO

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('ERROR: no command given. Example: node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs')
  process.exit(1)
}

const child = spawn(cmd, args, { env, stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
