#!/usr/bin/env node
// Emergency stop for a runaway brief-regeneration loop (cost incident, 2026-06-15).
//
// The notify cron auto-regenerates idle projects' briefs. When a brief always
// fails (e.g. regenerate_brief_max_tokens), a circuit breaker is supposed to stop
// retrying — but a bug makes it clear-and-retry every 5-min tick once the maker
// has messaged after the failure streak started, billing a Sonnet call each time.
//
// This sets brief_regen_failures_since = now so the breaker's
// "lastMakerAt > failuresSince" clause is false → the project stays circuit-broken
// and the cron skips it. TEMPORARY: resumes if the maker messages again, until the
// breaker code fix ships.
//
// Run via the WRITE prod-env wrapper (this mutates prod):
//   node scripts/with-prod-env.mjs node scripts/stop-regen-loop.mjs <projectId> [--apply]
// Dry-run (no --apply) prints what it would change.

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const projectId = process.argv[2]
const apply = process.argv.includes('--apply')
if (!projectId || projectId.startsWith('--')) {
  console.error('Usage: node scripts/stop-regen-loop.mjs <projectId> [--apply]')
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via scripts/with-prod-env.mjs)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const ref = db.collection('projects').doc(projectId)
const snap = await ref.get()
if (!snap.exists) {
  console.error(`Project ${projectId} not found`)
  process.exit(1)
}
const data = snap.data()
const now = new Date().toISOString()

console.log(`Project: ${data.title} (${projectId})`)
console.log(`  last_maker_message_at:        ${data.last_maker_message_at}`)
console.log(`  brief_regen_failures:         ${data.brief_regen_failures}`)
console.log(`  brief_regen_failures_since:   ${data.brief_regen_failures_since}  ->  ${now}`)
console.log(`  brief_regen_last_error:       ${data.brief_regen_last_error}`)

if (!apply) {
  console.log('\nDry run. Re-run with --apply to set brief_regen_failures_since = now (stops the loop).')
  process.exit(0)
}

await ref.update({ brief_regen_failures_since: now })
console.log('\n✅ Applied. brief_regen_failures_since advanced past last_maker_message_at — the cron will now skip this project.')
