/**
 * Backfill `brief_role` onto existing project_members docs.
 *
 * RAAC Phase 3a introduces brief_role (originator|contributor|reviewer) as a
 * separate axis from the access-tier `role`. New memberships get it written at
 * share/claim/create time; existing rows predate the field. This sets it from
 * the legacy access tier, one time:
 *   maker → originator, builder → reviewer, apprentice → contributor,
 *   owner → null (ownership is access, not a brief-participation role).
 *
 * Idempotent: skips any row that already has brief_role set (incl. explicit
 * null for owners).
 *
 * Usage (via the env wrapper so the secrets hook stays happy):
 *   node scripts/with-prod-env.mjs node scripts/backfill-brief-role.mjs --dry-run
 *   node scripts/with-prod-env.mjs node scripts/backfill-brief-role.mjs --apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY

// Mirror of lib/roles/brief-role.ts defaultBriefRole (kept inline so the script
// has no build-step dependency on app TypeScript).
function defaultBriefRole(role) {
  switch (role) {
    case 'maker':
      return 'originator'
    case 'builder':
      return 'reviewer'
    case 'apprentice':
      return 'contributor'
    case 'owner':
      return null
    default:
      return null
  }
}

function initAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!serviceAccount) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT not set. Run via: node scripts/with-prod-env.mjs node scripts/backfill-brief-role.mjs --dry-run',
      )
    }
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
  }
}

initAdmin()
const db = getFirestore()

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (use --apply to write) ===' : '=== APPLY ===')

  const snap = await db.collection('project_members').get()
  console.log(`Found ${snap.size} project_members`)

  let updated = 0
  let unchanged = 0

  for (const doc of snap.docs) {
    const m = doc.data()

    // Already set (a valid value OR explicit null) → skip for idempotency.
    if (m.brief_role !== undefined) {
      unchanged++
      continue
    }

    const briefRole = defaultBriefRole(m.role)

    if (DRY_RUN) {
      console.log(`  WOULD SET  ${doc.id} (role=${m.role}, email=${m.email || '—'}): brief_role → ${briefRole}`)
    } else {
      await doc.ref.update({ brief_role: briefRole })
      console.log(`  SET  ${doc.id} (role=${m.role}): → ${briefRole}`)
    }
    updated++
  }

  console.log(`\nDone. Updated: ${updated}, Already set: ${unchanged}`)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
