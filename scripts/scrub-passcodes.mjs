#!/usr/bin/env node
// One-time scrub for Garm PR D: remove the retired `passcode` field from every
// project_members doc. Passcode auth is gone (the route answers 410, nothing
// mints or reads the field), so the plaintext credential has no reason to keep
// sitting in Firestore — this deletes the FIELD only, never a doc.
//
// Dry run (default) — reports which docs carry a passcode, writes nothing:
//   node scripts/with-preview-env.mjs node scripts/scrub-passcodes.mjs
//
// Apply — removes the field via FieldValue.delete():
//   node scripts/with-preview-env.mjs node scripts/scrub-passcodes.mjs --apply
//
// Prod, when Nico says go (same shape, prod creds):
//   node scripts/with-prod-env.mjs node scripts/scrub-passcodes.mjs --apply
//
// Idempotent: a second run finds 0 docs. Emails are never printed — docs are
// identified by id + project_id only.

import { FieldValue } from 'firebase-admin/firestore'
import { initAdminDb } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')

async function main() {
  const { db } = initAdminDb()

  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (pass --apply to write) ===')

  const snap = await db.collection('project_members').get()
  const carriers = snap.docs.filter((doc) => doc.data().passcode !== undefined)

  console.log(`project_members: ${snap.size} docs, ${carriers.length} with a passcode field`)

  let scrubbed = 0
  for (const doc of carriers) {
    console.log(`  ${doc.id} (project ${doc.data().project_id ?? '?'})`)
    if (APPLY) {
      await doc.ref.update({
        passcode: FieldValue.delete(),
        updated_at: new Date().toISOString(),
      })
      scrubbed++
    }
  }

  if (APPLY) {
    console.log(`Scrubbed ${scrubbed} docs.`)
  } else if (carriers.length > 0) {
    console.log('Dry run — nothing written. Re-run with --apply to scrub.')
  } else {
    console.log('Nothing to scrub.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
