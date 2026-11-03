#!/usr/bin/env node
// One-off backfill for projects.thumbs_down_count (the dashboard's 👎 count).
// PATCH/DELETE /api/messages keep the counter from the release that added it;
// 👎 ratings given before that release are counted here once.
//
// Counts agent messages with rating 'down' per project (archived sessions
// included, as the live counter does) and sets the counter to that number.
// Prints project ids and counts only, never message text.
//
// Dry-run (read-only wrapper):
//   node scripts/with-prod-env-ro.mjs node scripts/backfill-thumbs-down-count.mjs
// Apply (write wrapper):
//   node scripts/with-prod-env.mjs node scripts/backfill-thumbs-down-count.mjs --apply

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const apply = process.argv.includes('--apply')

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via scripts/with-prod-env.mjs)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

// session id → project id
const sessions = await db.collection('sessions').select('project_id').get()
const projectOf = new Map(sessions.docs.map((d) => [d.id, d.data().project_id]))

const downs = await db.collection('messages').where('rating', '==', 'down').select('session_id', 'role').get()
const counts = new Map()
for (const m of downs.docs) {
  if (m.data().role !== 'agent') continue
  const projectId = projectOf.get(m.data().session_id)
  if (!projectId) continue
  counts.set(projectId, (counts.get(projectId) ?? 0) + 1)
}

const ups = await db.collection('messages').where('rating', '==', 'up').count().get()
console.log(`👎 on agent replies: ${downs.size} across ${counts.size} project(s); 👍: ${ups.data().count}`)

for (const [projectId, n] of counts) {
  const ref = db.collection('projects').doc(projectId)
  const snap = await ref.get()
  if (!snap.exists) continue
  const current = snap.data().thumbs_down_count ?? 0
  console.log(`${projectId}: ${current} -> ${n}`)
  if (apply && current !== n) await ref.update({ thumbs_down_count: n })
}

console.log(apply ? 'Applied.' : 'Dry run. Re-run with --apply via scripts/with-prod-env.mjs to write.')
