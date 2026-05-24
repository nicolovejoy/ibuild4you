#!/usr/bin/env node
// One-off: figure out why brief.generate keeps firing for given project ids.
// Compares last_maker_message_at vs latest brief.updated_at and prints the
// circuit-breaker fields. If updated_at < last_maker_message_at after a
// successful regen, the upsert path has a bug.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error('Usage: node scripts/debug-stuck-briefs.mjs <project_id> [<project_id> ...]')
  process.exit(1)
}

for (const id of ids) {
  const p = await db.collection('projects').doc(id).get()
  const d = p.data() || {}
  console.log(`\n=== ${id} — ${d.title || '(no title)'} ===`)
  console.log('  last_maker_message_at      :', d.last_maker_message_at)
  console.log('  notify_after               :', d.notify_after)
  console.log('  brief_regen_failures       :', d.brief_regen_failures)
  console.log('  brief_regen_failures_since :', d.brief_regen_failures_since)
  console.log('  brief_regen_last_error     :', d.brief_regen_last_error)
  console.log('  brief_regen_last_error_at  :', d.brief_regen_last_error_at)

  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', id)
    .orderBy('version', 'desc')
    .limit(3)
    .get()
  console.log(`  briefs (top 3 by version): ${briefSnap.size}`)
  for (const b of briefSnap.docs) {
    const bd = b.data()
    console.log(`    v${bd.version}  updated_at=${bd.updated_at}  id=${b.id}`)
  }

  // Cron decision: skip if briefUpdatedAt >= lastMakerAt
  const briefUpdatedAt = briefSnap.empty ? null : briefSnap.docs[0].data().updated_at
  const wouldSkip = briefUpdatedAt && briefUpdatedAt >= d.last_maker_message_at
  console.log(`  cron would skip?           : ${wouldSkip} (brief ${briefUpdatedAt} vs maker ${d.last_maker_message_at})`)
}

process.exit(0)
