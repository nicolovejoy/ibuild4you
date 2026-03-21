/**
 * Backfill project_members from existing project data.
 *
 * For each project:
 * - Creator (requester_id) → owner membership (looks up email from users collection)
 * - Shared user (requester_email) → maker membership
 * - ADMIN_EMAILS → skipped (implicit owner via env var)
 *
 * Idempotent: skips if a membership record already exists for that project + email.
 *
 * Usage:
 *   node --env-file=.env.local scripts/backfill-project-members.mjs
 *
 * Add --dry-run to preview without writing:
 *   node --env-file=.env.local scripts/backfill-project-members.mjs --dry-run
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const DRY_RUN = process.argv.includes('--dry-run')

const ADMIN_EMAILS = ['nlovejoy@me.com', 'nicholas.lovejoy@gmail.com', 'mlovejoy@scu.edu']

function initAdmin() {
  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!serviceAccount) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT not set. Run with: node --env-file=.env.local scripts/backfill-project-members.mjs')
    }
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
  }
}

initAdmin()
const db = getFirestore()

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== BACKFILL ===')

  // Load all projects
  const projectsSnap = await db.collection('projects').get()
  console.log(`Found ${projectsSnap.size} projects`)

  // Build a uid → email map from users collection
  const usersSnap = await db.collection('users').get()
  const uidToEmail = new Map()
  for (const doc of usersSnap.docs) {
    uidToEmail.set(doc.id, doc.data().email)
  }

  let created = 0
  let skipped = 0

  for (const projectDoc of projectsSnap.docs) {
    const project = projectDoc.data()
    const projectId = projectDoc.id

    // Collect emails to create memberships for
    const memberships = [] // { email, user_id, role }

    // Creator → owner
    if (project.requester_id) {
      const creatorEmail = uidToEmail.get(project.requester_id)
      if (creatorEmail && !ADMIN_EMAILS.includes(creatorEmail)) {
        memberships.push({
          email: creatorEmail,
          user_id: project.requester_id,
          role: 'owner',
        })
      }
    }

    // Shared user → maker (if different from creator)
    if (project.requester_email) {
      const email = project.requester_email.toLowerCase()
      if (!ADMIN_EMAILS.includes(email)) {
        const existing = memberships.find((m) => m.email === email)
        if (!existing) {
          // Try to find user_id
          const userDoc = usersSnap.docs.find((d) => d.data().email === email)
          memberships.push({
            email,
            user_id: userDoc?.id || '',
            role: 'maker',
          })
        }
      }
    }

    for (const m of memberships) {
      // Check if membership already exists
      const existingSnap = await db
        .collection('project_members')
        .where('project_id', '==', projectId)
        .where('email', '==', m.email)
        .limit(1)
        .get()

      if (!existingSnap.empty) {
        console.log(`  SKIP  ${projectId} / ${m.email} (already exists as ${existingSnap.docs[0].data().role})`)
        skipped++
        continue
      }

      const now = new Date().toISOString()
      const record = {
        project_id: projectId,
        user_id: m.user_id,
        email: m.email,
        role: m.role,
        added_by: 'backfill-script',
        created_at: now,
        updated_at: now,
      }

      if (DRY_RUN) {
        console.log(`  WOULD CREATE  ${projectId} / ${m.email} → ${m.role}`)
      } else {
        await db.collection('project_members').add(record)
        console.log(`  CREATED  ${projectId} / ${m.email} → ${m.role}`)
      }
      created++
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`)
}

main().catch((err) => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
