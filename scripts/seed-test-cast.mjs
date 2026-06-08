#!/usr/bin/env node
// Seed a multi-human test cast onto ONE brief — the cheapest 5b prototype.
//
// Why this exists: the multi-human thesis (2+ people in a brief that Sam
// mediates) can only be tested with two real, separately-logged-in humans on
// the same brief. This script seeds a dedicated "cast" project on the PREVIEW
// sandbox DB with four passcode identities — Originator, Contributor, Reviewer,
// Owner — each with its own auth user + users-doc (so display names resolve in
// chat) + approved_emails entry + project_members row carrying brief_role. It
// pre-creates one active session + a welcome message so both humans land on the
// SAME conversation immediately.
//
// Run via the preview env wrapper (never prod — this writes test identities):
//   node scripts/with-preview-env.mjs node scripts/seed-test-cast.mjs           # dry-run
//   node scripts/with-preview-env.mjs node scripts/seed-test-cast.mjs --apply   # write
//
// Passcodes: deterministic if SEED_PASSCODE_<ROLE> env vars are set (stash them
// in 1Password / .env.preview.local); otherwise random. On --apply the full
// {email: passcode} map is copied to the clipboard as JSON and written to the
// gitignored .test-cast-passcodes.json so the e2e login script can read it.
// Passcodes are never printed to stdout.

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const APPLY = process.argv.includes('--apply')

const PROJECT_TITLE = 'Test Cast — Cozy Italian Café (5b)'
const PROJECT_SLUG = 'test-cast-cafe'

// The cast. brief_role is what each person is *doing*; role is the access tier.
// Originator + Contributor are the focus (both chat with Sam in the same brief);
// Reviewer + Owner are seeded so role flows are testable later (3c / 5b).
const CAST = [
  { key: 'originator',  email: 'test-originator@ibuild4you.com',  first: 'Mara',   last: 'O', role: 'maker',   brief_role: 'originator' },
  { key: 'contributor', email: 'test-contributor@ibuild4you.com', first: 'Tomas',  last: 'C', role: 'maker',   brief_role: 'contributor' },
  { key: 'reviewer',    email: 'test-reviewer@ibuild4you.com',    first: 'Renata', last: 'R', role: 'builder', brief_role: 'reviewer' },
  { key: 'owner',       email: 'test-owner@ibuild4you.com',       first: 'Olivia', last: 'W', role: 'owner',   brief_role: null },
]

const WELCOME_MESSAGE =
  "Hi! I'm Sam. I hear you're dreaming up a cozy Italian café in Seattle — tell me about it and who's working on it with you."

// A little starting substance so Sam has context for the multi-human test.
const BRIEF_CONTENT = {
  problem: 'No warm neighborhood café in the Fremont area of Seattle that feels genuinely Italian.',
  target_users: 'Local residents and remote workers who want a third place.',
  features: ['Espresso bar', 'Small pastry kitchen', 'Evening wine + aperitivo'],
  constraints: 'Small footprint storefront; tight opening budget.',
  additional_context: '',
  decisions: [],
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (use scripts/with-preview-env.mjs as wrapper)')
  process.exit(1)
}
// Guard: refuse to --apply unless the service account targets the preview
// sandbox. The SA's own project_id is authoritative (the NEXT_PUBLIC_* env var
// isn't always present in the wrapper's env file).
const firebaseProjectId = (() => {
  try {
    return JSON.parse(sa).project_id || ''
  } catch {
    return ''
  }
})()
if (APPLY && !firebaseProjectId.includes('preview')) {
  console.error(`Refusing to --apply: Firebase project is "${firebaseProjectId}", not the preview sandbox.`)
  console.error('This cast is for preview only. Run via scripts/with-preview-env.mjs.')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()
const adminAuth = getAuth()

function generatePasscode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function getOrCreateAuthUser(member) {
  try {
    const u = await adminAuth.getUserByEmail(member.email)
    return { uid: u.uid, created: false }
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err
    if (!APPLY) return { uid: '(would create)', created: true }
    const u = await adminAuth.createUser({
      email: member.email,
      displayName: `${member.first} ${member.last}`,
      emailVerified: true,
    })
    return { uid: u.uid, created: true }
  }
}

async function upsertUserDoc(uid, member) {
  if (!APPLY) return
  const now = new Date().toISOString()
  await db.collection('users').doc(uid).set(
    {
      email: member.email,
      first_name: member.first,
      last_name: member.last,
      source: 'seed-test-cast',
      updated_at: now,
      created_at: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
}

async function upsertApprovedEmail(member) {
  if (!APPLY) return
  await db.collection('approved_emails').doc(member.email).set(
    { email: member.email, source: 'seed-test-cast', updated_at: new Date().toISOString() },
    { merge: true },
  )
}

async function findOrCreateProject() {
  const snap = await db.collection('projects').where('slug', '==', PROJECT_SLUG).limit(1).get()
  if (!snap.empty) return { id: snap.docs[0].id, created: false }
  if (!APPLY) return { id: '(would create)', created: true }
  const now = new Date().toISOString()
  const ref = await db.collection('projects').add({
    title: PROJECT_TITLE,
    slug: PROJECT_SLUG,
    status: 'active',
    requester_email: CAST[0].email,
    requester_first_name: CAST[0].first,
    requester_last_name: CAST[0].last,
    context: 'Synthetic 5b multi-human test cast. Two makers (Originator + Contributor) chat with Sam in this one brief. Safe to delete when rotating.',
    welcome_message: WELCOME_MESSAGE,
    session_mode: 'discover',
    auto_reminders_enabled: false,
    reminders_sent_count: 0,
    last_reminder_sent_at: null,
    created_at: now,
    updated_at: now,
  })
  return { id: ref.id, created: true }
}

// One active session + a welcome message so both humans land on the SAME
// conversation. Idempotent: skip if the project already has any session.
async function ensureActiveSession(pid) {
  const existing = await db.collection('sessions').where('project_id', '==', pid).limit(1).get()
  if (!existing.empty) return { action: 'exists' }
  if (!APPLY) return { action: 'would-create' }
  const now = new Date().toISOString()
  const sessionRef = await db.collection('sessions').add({
    project_id: pid,
    status: 'active',
    session_mode: 'discover',
    welcome_message: WELCOME_MESSAGE,
    created_at: now,
    updated_at: now,
  })
  await db.collection('messages').add({
    session_id: sessionRef.id,
    role: 'agent',
    content: WELCOME_MESSAGE,
    created_at: now,
    updated_at: now,
  })
  return { action: 'created' }
}

// Optional starting brief so Sam has context.
async function ensureBrief(pid) {
  const existing = await db.collection('briefs').where('project_id', '==', pid).limit(1).get()
  if (!existing.empty) return 'exists'
  if (!APPLY) return 'would-create'
  const now = new Date().toISOString()
  await db.collection('briefs').add({
    project_id: pid,
    version: 1,
    content: BRIEF_CONTENT,
    created_at: now,
    updated_at: now,
  })
  return 'created'
}

async function upsertMembership(pid, member, uid, passcode) {
  const existing = await db
    .collection('project_members')
    .where('project_id', '==', pid)
    .where('email', '==', member.email)
    .limit(1)
    .get()
  const now = new Date().toISOString()
  const payload = {
    project_id: pid,
    user_id: APPLY ? uid : '',
    email: member.email,
    role: member.role,
    brief_role: member.brief_role,
    passcode,
    added_by: 'seed-test-cast',
    updated_at: now,
  }
  if (existing.empty) {
    if (!APPLY) return 'would-create'
    await db.collection('project_members').add({ ...payload, created_at: now })
    return 'created'
  }
  if (!APPLY) return 'would-rotate'
  await existing.docs[0].ref.update(payload)
  return 'rotated'
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)
console.log(`Cast project: ${PROJECT_TITLE} (slug: ${PROJECT_SLUG})`)
console.log()

const project = await findOrCreateProject()
console.log(`Project: ${project.created ? 'create' : 'reuse'} → id=${project.id}`)

const session = await ensureActiveSession(project.id)
console.log(`Active session: ${session.action}`)

const brief = await ensureBrief(project.id)
console.log(`Brief: ${brief}`)
console.log()

const passcodeMap = {}
for (const member of CAST) {
  const envKey = `SEED_PASSCODE_${member.key.toUpperCase()}`
  const passcode = (process.env[envKey]?.trim() || generatePasscode()).toUpperCase()
  passcodeMap[member.email] = passcode

  const authUser = await getOrCreateAuthUser(member)
  await upsertUserDoc(authUser.uid, member)
  await upsertApprovedEmail(member)
  const action = await upsertMembership(project.id, member, authUser.uid, passcode)
  console.log(
    `  ${member.key.padEnd(11)} ${member.email.padEnd(34)} role=${member.role.padEnd(7)} brief_role=${member.brief_role ?? 'null'} → ${action}`,
  )
}
console.log()

if (APPLY) {
  const json = JSON.stringify(passcodeMap, null, 2)
  writeFileSync('.test-cast-passcodes.json', json + '\n')
  const r = spawnSync('pbcopy', { input: json })
  console.log('=============================================')
  console.log('PASSCODES → .test-cast-passcodes.json (gitignored) + clipboard')
  console.log('=============================================')
  console.log('Sign in at https://preview.ibuild4you.com/auth/login as each email + its passcode.')
  console.log('Originator + Contributor both open the SAME brief → chat with Sam together.')
  console.log(r.status === 0 ? '(passcode JSON also on clipboard)' : '(pbcopy failed — read the file)')
} else {
  console.log('Dry-run complete. Re-run with --apply to write + emit passcodes.')
}

process.exit(0)
