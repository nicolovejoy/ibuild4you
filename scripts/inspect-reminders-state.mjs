#!/usr/bin/env node
// Read-only snapshot of reminders state: opted-in projects + their cadence
// fields, plus recent reminder_log decisions (correct schema: decision/
// decided_at/maker_email). Run via with-prod-env-ro.mjs.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const projSnap = await db
  .collection('projects')
  .where('auto_reminders_enabled', '==', true)
  .get()

console.log(`Opted-in projects (auto_reminders_enabled==true): ${projSnap.size}\n`)
for (const d of projSnap.docs) {
  const p = d.data()
  console.log(`  slug=${p.slug}  id=${d.id}`)
  console.log(`    requester_email      = ${p.requester_email ?? '(none)'}`)
  console.log(`    shared_at            = ${p.shared_at ?? '(none)'}`)
  console.log(`    latest_session_at    = ${p.latest_session_created_at ?? '(none)'}`)
  console.log(`    last_maker_message   = ${p.last_maker_message_at ?? '(none)'}`)
  console.log(`    reminders_sent_count = ${p.reminders_sent_count ?? 0}`)
  console.log(`    last_reminder_sent   = ${p.last_reminder_sent_at ?? '(none)'}`)
  console.log('')
}

const logSnap = await db.collection('reminder_log').get()
const rows = logSnap.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .sort((a, b) => (a.decided_at || '').localeCompare(b.decided_at || ''))

console.log(`\nreminder_log rows total: ${rows.length}`)
const byDecision = new Map()
for (const r of rows) {
  const key = `${r.dry_run ? 'DRY' : 'LIVE'}/${r.decision}`
  byDecision.set(key, (byDecision.get(key) || 0) + 1)
}
console.log('By decision:')
for (const [k, v] of byDecision) console.log(`  ${k}: ${v}`)

console.log('\nLast 20 rows:')
for (const r of rows.slice(-20)) {
  console.log(
    `  ${r.decided_at}  ${r.dry_run ? 'DRY' : 'LIVE'}  ${r.decision}` +
      `  pid=${r.project_id}  #${r.reminder_number ?? '-'}` +
      `  days=${r.days_since_last_touch ?? '-'}  reason=${r.reason ?? '-'}`,
  )
}

process.exit(0)
