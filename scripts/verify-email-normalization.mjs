#!/usr/bin/env node
// Verify (and optionally fix) that stored email fields are normalized
// (trim + lowercase) across the collections #155 cares about. Prod data was
// confirmed 100% clean on 2026-07-16 (see docs/155-email-normalization-plan.md
// §3) — this script exists to keep it that way and to close the race window
// between that audit and the #155 deploy (a mixed-case row could only land
// via the three raw-write sites the PR fixes).
//
// Check mode (default): reports dirty rows, exits 1 if any exist. Safe to
// run against prod read-only creds.
//   node scripts/with-prod-env-ro.mjs node scripts/verify-email-normalization.mjs
//
// Fix mode: normalizes dirty rows in place (update-only, no deletes,
// idempotent — consistent with the no-hard-deletes convention). Needs
// write creds.
//   node scripts/with-prod-env.mjs node scripts/verify-email-normalization.mjs --fix
//
// approved_emails is checked on its `email` field only. Its doc ID is ALSO
// supposed to equal the normalized email (the app looks docs up by
// normalizeEmail(email)) — a mismatched ID is reported but never auto-fixed,
// since fixing it means create-new-doc + delete-old-doc, not an update, and
// that decision needs a human. None exist as of the 2026-07-16 audit.

import { initAdminDb } from './fixtures/db.mjs'

const FIX = process.argv.includes('--fix')

// Mirrors lib/email/normalize.ts exactly (plain JS — scripts have no TS
// runner in this repo). Keep these two in sync if that file ever changes.
function normalizeEmail(email) {
  return (email ?? '').trim().toLowerCase()
}

// [collection, field] pairs to check. approved_emails' doc-ID case is
// handled separately below (report-only, see file header).
const TARGETS = [
  ['project_members', 'email'],
  ['projects', 'requester_email'],
  ['approved_emails', 'email'],
  ['users', 'email'],
]

async function main() {
  const { db } = initAdminDb()

  console.log(FIX ? '=== FIX MODE ===' : '=== CHECK MODE (read-only) ===')

  let dirty = 0
  let fixed = 0

  for (const [collection, field] of TARGETS) {
    const snap = await db.collection(collection).get()
    for (const doc of snap.docs) {
      const value = doc.data()[field]
      if (typeof value !== 'string' || !value) continue
      const normalized = normalizeEmail(value)
      if (value === normalized) continue

      dirty++
      console.log(`${collection}/${doc.id} ${field}: "${value}" needs normalization`)
      if (FIX) {
        await doc.ref.update({ [field]: normalized, updated_at: new Date().toISOString() })
        fixed++
      }
    }
  }

  // Report-only: approved_emails doc IDs that don't match their normalized
  // form. A mismatch here means the doc is unreachable via the app's own
  // doc(normalizeEmail(email)) lookup — a real bug, but fixing it is a
  // create+delete decision for a human, not this script.
  const approvedSnap = await db.collection('approved_emails').get()
  for (const doc of approvedSnap.docs) {
    const normalizedId = normalizeEmail(doc.id)
    if (doc.id !== normalizedId) {
      console.log(
        `approved_emails/${doc.id}: doc ID is not normalized (would be "${normalizedId}") — ` +
          'NOT auto-fixed, needs a manual create-then-supersede decision.'
      )
    }
  }

  if (dirty === 0) {
    console.log('CLEAN — no non-normalized email fields found.')
    process.exit(0)
  }

  console.log(
    FIX
      ? `${fixed}/${dirty} row(s) fixed.`
      : `${dirty} row(s) dirty — rerun with --fix (via scripts/with-prod-env.mjs) to normalize.`
  )
  process.exit(FIX ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
