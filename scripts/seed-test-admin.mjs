#!/usr/bin/env node
// Seed a passcode-based admin login for end-to-end testing.
//
// Why this exists: /admin/* pages need an admin login, but Google OAuth
// can't be driven by Playwright. This script creates a project_members row
// for an existing hardcoded admin email (lib/constants.ts ADMIN_EMAILS),
// so the passcode-login path grants admin access without OAuth.
//
// Run via the .env wrapper:
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin.mjs            # dry-run
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin.mjs --apply    # write
//
// After --apply, copy the printed passcode into 1Password (dev-secrets vault).
// The passcode is printed once; if lost, re-run --apply to rotate.

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const APPLY = process.argv.includes('--apply')

// Must match an entry in lib/constants.ts ADMIN_EMAILS so the user already
// has admin role by virtue of email alone — no users-doc setup needed.
const ADMIN_EMAIL = 'nicholas.lovejoy@gmail.com'
const TEST_PROJECT_TITLE = 'Test Admin Access (Playwright)'
const TEST_PROJECT_SLUG = 'test-admin-access'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (use scripts/with-prod-env.mjs as wrapper)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

// Generate a 10-char upper-alphanumeric passcode (no ambiguous chars).
// The passcode-login route uppercases input, so we generate uppercase.
function generatePasscode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 — easier to read
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
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

const passcode = generatePasscode()
const project = await findOrCreateTestProject()
console.log(`Project: ${project.created ? 'create' : 'reuse'} → id=${project.id}`)

const result = await upsertMembership(project.id, passcode)
console.log(`Membership: ${result.action}`)
console.log()

if (APPLY) {
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
