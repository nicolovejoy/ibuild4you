#!/usr/bin/env node
// Read-only: print recent chat-route api_usage rows per session so we can see
// prompt-cache behaviour turn by turn. Verifies the PR #207 split system
// prompt: on the turn after a >=1h gap, expect cache_read roughly the size of
// the stable prompt and a non-zero cache_creation for the re-written history.
//
// Usage (prod, read-only):
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs \
//     node scripts/api-usage-cache-check.mjs --days 7

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const daysIdx = process.argv.indexOf('--days')
const DAYS = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) : 7

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()
const snap = await db.collection('api_usage').where('created_at', '>=', since).get()
const rows = snap.docs
  .map((d) => d.data())
  .filter((r) => r.route === 'chat' || r.route === 'chat/kickoff')
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))

console.log(`chat rows in last ${DAYS}d: ${rows.length}\n`)

// Group by session so consecutive turns sit next to each other.
const bySession = new Map()
for (const r of rows) {
  const k = r.session_id || r.project_id || '?'
  if (!bySession.has(k)) bySession.set(k, [])
  bySession.get(k).push(r)
}

const fmt = (n) => String(n ?? 0).padStart(7)
for (const [sid, turns] of bySession) {
  console.log(`session ${sid}  (${turns.length} turns)`)
  console.log(
    `  ${'created_at (UTC)'.padEnd(24)} ${'gap'.padStart(7)} ${'input'.padStart(7)} ${'c_read'.padStart(7)} ${'c_write'.padStart(7)}  model`
  )
  let prev = null
  for (const t of turns) {
    const at = new Date(t.created_at)
    const gapMin = prev ? Math.round((at - prev) / 60000) : null
    const gap = gapMin == null ? '-' : gapMin >= 60 ? `${Math.round(gapMin / 60)}h` : `${gapMin}m`
    console.log(
      `  ${String(t.created_at).slice(0, 19).padEnd(24)} ${gap.padStart(7)} ${fmt(t.input_tokens)} ${fmt(t.cache_read_input_tokens)} ${fmt(t.cache_creation_input_tokens)}  ${t.model || ''}`
    )
    prev = at
  }
  console.log()
}
