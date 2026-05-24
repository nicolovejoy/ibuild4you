#!/usr/bin/env node
// Hot-patch for the brief-regen loop bug. For each project listed, find the
// latest brief doc and bump `updated_at` to now. That makes the cron's existing
// skip condition (`briefUpdatedAt >= lastMakerAt`) kick in, halting the loop
// without changing brief content.
//
// Identified by scripts/api-usage-by-project.mjs as the projects burning
// cost in a 5-minute regen loop because `JSON.parse` on a truncated Claude
// response throws — brief never gets written, cron retries forever.
//
// Usage:
//   export FIREBASE_SERVICE_ACCOUNT=$(grep '^FIREBASE_SERVICE_ACCOUNT=' .env.local | cut -d= -f2-)
//   node scripts/touch-stuck-briefs.mjs            # dry-run
//   node scripts/touch-stuck-briefs.mjs --apply    # actually write

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

const STUCK_PROJECT_IDS = [
  '0kFhweZTAdtwxsfotE1H', // Med Tracking for ORCA Center
  'oLgKcqhseCnDev6Zx81v', // NWMLS Contract Generator
  'IyMeSmhWnEzaAr9i67cs', // iBuild4you UX Rethink — Maker Experience
  'WlAyoxtUKpxxYSsmAF46', // ORCA Center Med Tracking — maker view
]

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const now = new Date().toISOString()
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
console.log(`Setting briefs.updated_at = ${now}\n`)

for (const projectId of STUCK_PROJECT_IDS) {
  const projDoc = await db.collection('projects').doc(projectId).get()
  const title = projDoc.data()?.title || '(not found)'
  const lastMakerAt = projDoc.data()?.last_maker_message_at || '(none)'

  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (briefSnap.empty) {
    const stubContent = {
      problem: '',
      target_users: '',
      features: [],
      constraints: '',
      additional_context: '',
      decisions: [],
      open_risks: [],
    }
    console.log(`  ${projectId}  ${title}`)
    console.log(`    NO BRIEF — will create stub (version 1)`)
    console.log(`    last_maker_message_at = ${lastMakerAt}`)
    if (APPLY) {
      await db.collection('briefs').add({
        project_id: projectId,
        version: 1,
        content: stubContent,
        created_at: now,
        updated_at: now,
      })
      console.log(`    ✓ stub created`)
    }
    continue
  }
  const briefDoc = briefSnap.docs[0]
  const oldUpdatedAt = briefDoc.data().updated_at || '(unset)'

  console.log(`  ${projectId}  ${title}`)
  console.log(`    brief.id=${briefDoc.id}  version=${briefDoc.data().version}`)
  console.log(`    last_maker_message_at = ${lastMakerAt}`)
  console.log(`    brief.updated_at      = ${oldUpdatedAt}  →  ${now}`)

  if (APPLY) {
    await briefDoc.ref.update({ updated_at: now })
    console.log(`    ✓ updated`)
  }
}

console.log(APPLY ? '\nDone.' : '\nDry-run. Re-run with --apply to write.')
process.exit(0)
