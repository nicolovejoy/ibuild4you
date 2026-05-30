/**
 * Backfill `latest_session_created_at` onto existing project docs.
 *
 * The maker-reminders cron anchors its cadence on project.latest_session_created_at.
 * That field is written on session creation going forward (app/api/sessions and
 * the project-create path), but existing projects predate the write and have it
 * undefined — so the cron falls back to the stale shared_at. This sets it to the
 * newest session's created_at per project, one time.
 *
 * Idempotent-ish: recomputes from sessions each run; only writes when the value
 * differs from what's already persisted.
 *
 * Usage (via the env wrapper so the secrets hook stays happy):
 *   node scripts/with-prod-env.mjs node scripts/backfill-latest-session.mjs --dry-run
 *   node scripts/with-prod-env.mjs node scripts/backfill-latest-session.mjs --apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY

function initAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!serviceAccount) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT not set. Run via: node scripts/with-prod-env.mjs node scripts/backfill-latest-session.mjs --dry-run',
      )
    }
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
  }
}

initAdmin()
const db = getFirestore()

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (use --apply to write) ===' : '=== APPLY ===')

  const projectsSnap = await db.collection('projects').get()
  console.log(`Found ${projectsSnap.size} projects`)

  let updated = 0
  let unchanged = 0
  let noSessions = 0

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id
    const project = projectDoc.data()

    const sessionsSnap = await db
      .collection('sessions')
      .where('project_id', '==', projectId)
      .select('created_at')
      .get()

    let latest = null
    for (const s of sessionsSnap.docs) {
      const createdAt = s.data().created_at
      if (typeof createdAt === 'string' && (!latest || createdAt > latest)) {
        latest = createdAt
      }
    }

    if (!latest) {
      noSessions++
      continue
    }

    if (project.latest_session_created_at === latest) {
      unchanged++
      continue
    }

    if (DRY_RUN) {
      console.log(
        `  WOULD SET  ${projectId} (${project.slug || 'no-slug'}): ${project.latest_session_created_at ?? 'undefined'} → ${latest}`,
      )
    } else {
      await projectDoc.ref.update({ latest_session_created_at: latest })
      console.log(`  SET  ${projectId} (${project.slug || 'no-slug'}): → ${latest}`)
    }
    updated++
  }

  console.log(
    `\nDone. Updated: ${updated}, Already correct: ${unchanged}, No sessions: ${noSessions}`,
  )
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
