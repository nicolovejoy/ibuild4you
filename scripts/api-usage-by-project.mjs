#!/usr/bin/env node
// Roll up api_usage by project_id to find which projects are burning cost.
// Helps identify runaway loops (one project regenerating its brief forever).
//
// Usage:
//   export FIREBASE_SERVICE_ACCOUNT=$(grep '^FIREBASE_SERVICE_ACCOUNT=' .env.local | cut -d= -f2-)
//   node scripts/api-usage-by-project.mjs --route brief.generate --days 3

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const daysIdx = process.argv.indexOf('--days')
const DAYS = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) : 3
const routeIdx = process.argv.indexOf('--route')
const ROUTE = routeIdx >= 0 ? process.argv[routeIdx + 1] : null

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()
const snap = await db.collection('api_usage').where('created_at', '>=', since).get()
let rows = snap.docs.map((d) => d.data())
if (ROUTE) rows = rows.filter((r) => r.route === ROUTE)

const byProj = new Map()
for (const r of rows) {
  const k = r.project_id
  const cur = byProj.get(k) || { calls: 0, cost: 0 }
  cur.calls += 1
  cur.cost += r.cost_usd || 0
  byProj.set(k, cur)
}

const sorted = [...byProj.entries()].sort((a, b) => b[1].cost - a[1].cost)

console.log(`api_usage rows (route=${ROUTE || 'all'}, last ${DAYS}d): ${snap.size}\n`)
console.log(`${'project_id'.padEnd(36)}  ${'title'.padEnd(40)}  ${'calls'.padStart(6)}  ${'cost'.padStart(8)}`)
for (const [pid, v] of sorted.slice(0, 20)) {
  const pdoc = await db.collection('projects').doc(pid).get()
  const title = (pdoc.data()?.title || '(deleted?)').slice(0, 40)
  console.log(`${pid.padEnd(36)}  ${title.padEnd(40)}  ${String(v.calls).padStart(6)}  $${v.cost.toFixed(2).padStart(7)}`)
}

process.exit(0)
