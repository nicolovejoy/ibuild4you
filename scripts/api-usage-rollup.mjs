#!/usr/bin/env node
// Roll up the api_usage collection by route, model, and day. Helps figure out
// where the Anthropic spend actually goes before optimizing.
//
// Usage:
//   export FIREBASE_SERVICE_ACCOUNT=$(grep FIREBASE_SERVICE_ACCOUNT .env.local | cut -d= -f2-)
//   node scripts/api-usage-rollup.mjs            # last 14 days
//   node scripts/api-usage-rollup.mjs --days 30

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const daysIdx = process.argv.indexOf('--days')
const DAYS = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) : 14

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
if (!serviceAccount) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT env var first.')
  process.exit(1)
}

initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
const db = getFirestore()

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()

const snap = await db
  .collection('api_usage')
  .where('created_at', '>=', since)
  .get()

console.log(`api_usage rows in last ${DAYS} days: ${snap.size}`)
console.log(`since: ${since}\n`)

const rows = snap.docs.map((d) => d.data())

function group(rows, keyFn) {
  const m = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    const cur = m.get(k) || { calls: 0, cost: 0, in: 0, out: 0, cr: 0, cc: 0 }
    cur.calls += 1
    cur.cost += r.cost_usd || 0
    cur.in += r.input_tokens || 0
    cur.out += r.output_tokens || 0
    cur.cr += r.cache_read_input_tokens || 0
    cur.cc += r.cache_creation_input_tokens || 0
    m.set(k, cur)
  }
  return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost)
}

function fmt(n, w = 10) {
  return String(n).padStart(w)
}
function dollars(n) {
  return `$${n.toFixed(2)}`
}

function printTable(title, entries) {
  console.log(`\n=== ${title} ===`)
  console.log(`${'key'.padEnd(36)}  ${'calls'.padStart(6)}  ${'cost'.padStart(8)}  ${'input'.padStart(10)}  ${'output'.padStart(10)}  ${'cache_r'.padStart(10)}  ${'cache_c'.padStart(10)}`)
  let totCost = 0, totCalls = 0
  for (const [k, v] of entries) {
    console.log(`${String(k).padEnd(36)}  ${fmt(v.calls, 6)}  ${dollars(v.cost).padStart(8)}  ${fmt(v.in, 10)}  ${fmt(v.out, 10)}  ${fmt(v.cr, 10)}  ${fmt(v.cc, 10)}`)
    totCost += v.cost
    totCalls += v.calls
  }
  console.log(`${'TOTAL'.padEnd(36)}  ${fmt(totCalls, 6)}  ${dollars(totCost).padStart(8)}`)
}

printTable('by route', group(rows, (r) => r.route))
printTable('by model', group(rows, (r) => r.model))
printTable('by route+model', group(rows, (r) => `${r.route} / ${r.model}`))

// Per-day totals
const byDay = group(rows, (r) => (r.created_at || '').slice(0, 10))
byDay.sort((a, b) => a[0].localeCompare(b[0]))
printTable('by day', byDay)

// Top-cost individual calls
const top = rows
  .map((r) => ({ ...r, cost_usd: r.cost_usd || 0 }))
  .sort((a, b) => b.cost_usd - a.cost_usd)
  .slice(0, 10)
console.log('\n=== top 10 individual calls ===')
for (const r of top) {
  console.log(`${dollars(r.cost_usd).padStart(8)}  ${r.route.padEnd(20)}  in=${fmt(r.input_tokens, 7)} out=${fmt(r.output_tokens, 6)} cr=${fmt(r.cache_read_input_tokens || 0, 7)} cc=${fmt(r.cache_creation_input_tokens || 0, 7)}  ${r.created_at}`)
}

process.exit(0)
