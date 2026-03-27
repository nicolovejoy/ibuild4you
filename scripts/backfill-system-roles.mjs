/**
 * Backfill system_roles on the two admin users.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-system-roles.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-system-roles.mjs
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')

const ADMIN_EMAILS = ['nicholas.lovejoy@gmail.com', 'mlovejoy@scu.edu']

function initAdmin() {
  if (getApps().length === 0) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT not set')
    initializeApp({ credential: cert(JSON.parse(sa)) })
  }
}

initAdmin()
const db = getFirestore()

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== BACKFILL ===')

  const usersSnap = await db.collection('users').get()
  let updated = 0

  for (const doc of usersSnap.docs) {
    const data = doc.data()
    const email = (data.email || '').toLowerCase()

    if (!ADMIN_EMAILS.includes(email)) continue

    // Skip if already set
    if (Array.isArray(data.system_roles) && data.system_roles.includes('admin')) {
      console.log(`${email}: already has admin role`)
      continue
    }

    if (DRY_RUN) {
      console.log(`WOULD SET system_roles: ['admin'] on ${email} (doc ${doc.id})`)
    } else {
      await doc.ref.update({
        system_roles: ['admin'],
        updated_at: new Date().toISOString(),
      })
      console.log(`SET system_roles: ['admin'] on ${email} (doc ${doc.id})`)
    }
    updated++
  }

  console.log(`\nDone. Updated: ${updated}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
