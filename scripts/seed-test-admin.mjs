#!/usr/bin/env node
// Seed a dedicated test admin user for Playwright end-to-end testing.
//
// Why this exists: /admin/* pages need an admin login, but Google OAuth
// can't be driven by Playwright. This script creates a fully isolated test
// identity (Firebase Auth user + users doc with admin role + project
// membership) so e2e auth never touches a human account. Revoking is a
// one-line script edit; rotating is just re-running --apply.
//
// Run via the .env wrapper:
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin.mjs            # dry-run
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin.mjs --apply    # write
//
// Garm PR D: passcode auth is retired — this script no longer mints or writes
// a passcode. The login credential is a password, set by the sibling script
// AFTER this one:
//   node scripts/with-preview-env.mjs node scripts/seed-test-admin-password.mjs --apply

import { FieldValue } from 'firebase-admin/firestore'
import { initAdminDb } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')

// Dedicated test identity — fully isolated from any human account.
// Not a real mailbox; emails sent to it will bounce (which is fine since
// admin emails bypass nudge/reminder flows anyway, and this account isn't
// listed as a project requester).
const ADMIN_EMAIL = 'test@ibuild4you.com'
const FIRST_NAME = 'Test'
const LAST_NAME = 'Admin'
const TEST_PROJECT_TITLE = 'Test Admin Access (Playwright)'
const TEST_PROJECT_SLUG = 'test-admin-access'

// Deliberately ungated init (targets prod AND preview), and deliberately NO
// seed_tag on any doc: the test admin is persistent infrastructure, not
// fixture data — tagging it would let `seed.mjs reset` wipe the e2e login.
const { db, adminAuth } = initAdminDb()

// Get the Firebase Auth user, creating one if it doesn't exist yet. The uid
// is needed to key the users-doc with system_roles=['admin'].
async function getOrCreateAuthUser() {
  try {
    const u = await adminAuth.getUserByEmail(ADMIN_EMAIL)
    return { uid: u.uid, created: false }
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err
    if (!APPLY) return { uid: '(would create)', created: true }
    const u = await adminAuth.createUser({
      email: ADMIN_EMAIL,
      displayName: `${FIRST_NAME} ${LAST_NAME}`,
      emailVerified: true,
    })
    return { uid: u.uid, created: true }
  }
}

async function upsertUserDoc(uid) {
  if (!APPLY) return 'would-upsert'
  const now = new Date().toISOString()
  await db.collection('users').doc(uid).set(
    {
      email: ADMIN_EMAIL,
      first_name: FIRST_NAME,
      last_name: LAST_NAME,
      system_roles: ['admin'],
      source: 'seed-test-admin',
      updated_at: now,
      created_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return 'upserted'
}

async function upsertApprovedEmail() {
  if (!APPLY) return 'would-upsert'
  await db.collection('approved_emails').doc(ADMIN_EMAIL).set(
    {
      email: ADMIN_EMAIL,
      source: 'seed-test-admin',
      updated_at: new Date().toISOString(),
    },
    { merge: true },
  )
  return 'upserted'
}

async function findOrCreateTestProject() {
  const snap = await db.collection('projects').where('slug', '==', TEST_PROJECT_SLUG).limit(1).get()
  if (!snap.empty) {
    return { id: snap.docs[0].id, created: false }
  }
  if (!APPLY) return { id: '(would create)', created: true }
  const now = new Date().toISOString()
  const ref = await db.collection('projects').add({
    title: TEST_PROJECT_TITLE,
    slug: TEST_PROJECT_SLUG,
    status: 'active',
    requester_email: ADMIN_EMAIL,
    requester_first_name: 'TestAdmin',
    requester_last_name: 'Playwright',
    context: 'Synthetic project used only as the project_members host for the e2e admin login. Do not delete unless rotating credentials.',
    session_mode: 'discover',
    auto_reminders_enabled: false,
    reminders_sent_count: 0,
    last_reminder_sent_at: null,
    created_at: now,
    updated_at: now,
  })
  return { id: ref.id, created: true }
}

async function upsertMembership(projectId) {
  // One project_members row per (project_id, email). Update in place if it
  // already exists. No passcode field — retired (Garm PR D); the scrub script
  // removes any stale one.
  const existing = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('email', '==', ADMIN_EMAIL)
    .limit(1)
    .get()

  const now = new Date().toISOString()
  const payload = {
    project_id: projectId,
    email: ADMIN_EMAIL,
    role: 'owner',
    updated_at: now,
  }
  if (existing.empty) {
    if (!APPLY) return { action: 'would-create' }
    await db.collection('project_members').add({ ...payload, created_at: now })
    return { action: 'created' }
  }
  if (!APPLY) return { action: 'would-update' }
  await existing.docs[0].ref.update(payload)
  return { action: 'updated' }
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log(`Admin email: ${ADMIN_EMAIL}`)
console.log(`Test project: ${TEST_PROJECT_TITLE} (slug: ${TEST_PROJECT_SLUG})`)
console.log()

const authUser = await getOrCreateAuthUser()
console.log(`Auth user: ${authUser.created ? 'create' : 'reuse'} → uid=${authUser.uid}`)

const userDoc = await upsertUserDoc(authUser.uid)
console.log(`Users doc (system_roles=['admin']): ${userDoc}`)

const approved = await upsertApprovedEmail()
console.log(`approved_emails entry: ${approved}`)

const project = await findOrCreateTestProject()
console.log(`Project: ${project.created ? 'create' : 'reuse'} → id=${project.id}`)

const result = await upsertMembership(project.id)
console.log(`Membership: ${result.action}`)
console.log()

if (APPLY) {
  console.log('Next: set the login password (writes gitignored .test-admin-password):')
  console.log('  node scripts/with-preview-env.mjs node scripts/seed-test-admin-password.mjs --apply')
} else {
  console.log('Dry-run complete. Re-run with --apply to write.')
}

process.exit(0)
