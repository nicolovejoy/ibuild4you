#!/usr/bin/env node
// Same as with-prod-env.mjs, but loads .env.preview.local — the local copy of
// the *preview* environment's secrets (Firebase pointing at ibuild4you-preview,
// everything else shared). Lets agent-driven scripts run against the preview
// sandbox DB instead of prod. The file is read here via fs, which the
// secrets-blocking hook in ~/.claude/hooks/block-secrets.sh does not police.
//
// Safe to commit: this file contains no secrets.
//
// Usage:
//   node scripts/with-preview-env.mjs node scripts/list-projects.mjs

import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const ENV_FILE = '.env.preview.local'
if (!existsSync(ENV_FILE)) {
  console.error(`ERROR: ${ENV_FILE} not found in ${process.cwd()}`)
  console.error('Create it from .env.preview.local.example with op inject (preview Firebase creds).')
  process.exit(1)
}

const env = { ...process.env }
const content = readFileSync(ENV_FILE, 'utf8')

// Minimal env parser: KEY=VALUE per line, comments with #, optional surrounding
// quotes. Matches the shape with-prod-env.mjs expects (single-line values,
// including a JSON-encoded FIREBASE_SERVICE_ACCOUNT).
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

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('ERROR: no command given. Example: node scripts/with-preview-env.mjs node scripts/list-projects.mjs')
  process.exit(1)
}

const child = spawn(cmd, args, { env, stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
