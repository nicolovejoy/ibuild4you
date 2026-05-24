#!/usr/bin/env node
// Inspect the reminder_log Firestore collection. PR #22 dry-run window — we
// want to see what would have been sent before flipping REMINDER_DRY_RUN off.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const daysIdx = process.argv.indexOf('--days')
const DAYS = daysIdx >= 0 ? Number(process.argv[daysIdx + 1]) : 3

const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()

const snap = await db.collection('reminder_log').get()
const rows = snap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((r) => !r.created_at || r.created_at >= since)
  .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))

console.log(`reminder_log rows (last ${DAYS}d): ${rows.length}\n`)

// Group by status / dry_run / project
const byStatus = new Map()
for (const r of rows) {
  const key = `${r.dry_run ? 'DRY_RUN' : 'LIVE'}/${r.status || 'unknown'}`
  byStatus.set(key, (byStatus.get(key) || 0) + 1)
}
console.log('By status:')
for (const [k, v] of byStatus) console.log(`  ${k}: ${v}`)

console.log('\nRecent rows:')
for (const r of rows.slice(-15)) {
  console.log(`  ${r.created_at}  ${r.dry_run ? 'DRY' : 'LIVE'}  ${r.status}  pid=${r.project_id}  reminder#${r.reminder_number}  to=${r.to}`)
}

process.exit(0)
