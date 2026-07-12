#!/usr/bin/env node
// Seed a dedicated test admin user for Playwright end-to-end testing.
//
// Why this exists: /admin/* pages need an admin login, but Google OAuth
// can't be driven by Playwright. This script creates a fully isolated test
// identity (Firebase Auth user + users doc with admin role + project
// membership with a passcode) so e2e auth never touches a human account.
// Revoking is a one-line script edit; rotating is just re-running --apply.
//
// Run via the .env wrapper:
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin.mjs            # dry-run
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin.mjs --apply    # write
//
// After --apply, the freshly generated passcode lands on the clipboard via
// pbcopy — it is never printed to stdout. Paste it into 1Password.

import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
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

// Generate a 10-char upper-alphanumeric passcode (no ambiguous chars).
// The passcode-login route uppercases input, so we generate uppercase.
function generatePasscode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 — easier to read
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

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
    context: 'Synthetic project used only as the project_members host for the passcode-based admin login. Do not delete unless rotating credentials.',
    session_mode: 'discover',
    auto_reminders_enabled: false,
    reminders_sent_count: 0,
    last_reminder_sent_at: null,
    created_at: now,
    updated_at: now,
  })
  return { id: ref.id, created: true }
}

async function upsertMembership(projectId, passcode) {
  // One project_members row per (project_id, email). Update in place if it
  // already exists so re-running rotates the passcode.
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
    passcode,
    updated_at: now,
  }
  if (existing.empty) {
    if (!APPLY) return { action: 'would-create' }
    await db.collection('project_members').add({ ...payload, created_at: now })
    return { action: 'created' }
  }
  if (!APPLY) return { action: 'would-rotate' }
  await existing.docs[0].ref.update(payload)
  return { action: 'rotated' }
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log(`Admin email: ${ADMIN_EMAIL}`)
console.log(`Test project: ${TEST_PROJECT_TITLE} (slug: ${TEST_PROJECT_SLUG})`)
console.log()

// Deterministic seeding: if SEED_PASSCODE is supplied (per-environment, stored
// in 1Password), reuse it so re-seeding is idempotent and the value in Firestore
// always matches what callers have on file. Falls back to a fresh random one.
// Uppercased because the passcode-login route uppercases input before matching.
const passcodeFromEnv = process.env.SEED_PASSCODE?.trim()
const passcode = (passcodeFromEnv || generatePasscode()).toUpperCase()

const authUser = await getOrCreateAuthUser()
console.log(`Auth user: ${authUser.created ? 'create' : 'reuse'} → uid=${authUser.uid}`)

const userDoc = await upsertUserDoc(authUser.uid)
console.log(`Users doc (system_roles=['admin']): ${userDoc}`)

const approved = await upsertApprovedEmail()
console.log(`approved_emails entry: ${approved}`)

const project = await findOrCreateTestProject()
console.log(`Project: ${project.created ? 'create' : 'reuse'} → id=${project.id}`)

const result = await upsertMembership(project.id, passcode)
console.log(`Membership: ${result.action}`)
console.log()

if (APPLY && passcodeFromEnv) {
  // Deterministic run: the caller already has the passcode (it came from env).
  // Nothing to copy or print — the value stays out of stdout entirely.
  console.log('Passcode: reused from SEED_PASSCODE (deterministic seed).')
} else if (APPLY) {
  // Pipe the passcode to pbcopy so it never lands in terminal scrollback or
  // chat history. Stdout only confirms success / instructions.
  const r = spawnSync('pbcopy', { input: passcode })
  const copied = r.status === 0
  console.log('=============================================')
  console.log(copied
    ? 'PASSCODE → clipboard (paste into 1Password now, then Playwright)'
    : 'PASSCODE generated but pbcopy failed — re-run on macOS')
  console.log('=============================================')
  console.log()
  console.log('Next steps:')
  console.log(`  1. Cmd+V the passcode into 1Password (dev-secrets vault).`)
  console.log(`     Suggested op command (run yourself — secrets hook blocks Claude):`)
  console.log(`       op item create --vault dev-secrets --category login \\`)
  console.log(`         --title "ibuild4you test admin passcode" \\`)
  console.log(`         username=${ADMIN_EMAIL} \\`)
  console.log(`         password="$(pbpaste)" \\`)
  console.log(`         url=https://ibuild4you.com/auth/login`)
  console.log(`  2. Sign in at https://ibuild4you.com/auth/login (email above + passcode).`)
  console.log(`  3. Future testing: \`pbcopy < <(op read 'op://dev-secrets/.../password')\` to`)
  console.log(`     stage the passcode, then paste into the Playwright window yourself.`)
} else {
  console.log('Dry-run complete. Re-run with --apply to actually create + copy passcode.')
}

process.exit(0)
