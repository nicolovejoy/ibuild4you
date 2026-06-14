// Scenario: seed a multi-human test cast onto ONE brief — the 5b prototype.
//
// The multi-human thesis (2+ people in a brief Sam mediates) can only be tested
// with two real, separately-logged-in humans on the same brief. This seeds a
// dedicated cast project on the preview sandbox with four passcode identities —
// Originator, Contributor, Reviewer, Owner — each with its own auth user +
// users-doc (so display names resolve in chat) + approved_emails entry +
// project_members row carrying brief_role. One active session + welcome message
// are pre-created so both humans land on the SAME conversation.
//
// Migrated from the standalone scripts/seed-test-cast.mjs onto the shared
// fixtures lib (#61). Project/session/message/brief/member docs are now
// seed-tagged so cleanAll({ scenario }) removes them; the auth users, user docs,
// and approved_emails are reusable test identities and are left in place.
//
// Passcodes: deterministic if SEED_PASSCODE_<ROLE> env vars are set (stash them
// in 1Password / .env.preview.local); otherwise random. On apply the full
// {email: passcode} map is copied to the clipboard as JSON and written to the
// gitignored .test-cast-passcodes.json. Passcodes are never printed to stdout.

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { FieldValue } from 'firebase-admin/firestore'
import { iso, makeProject, addSession, addMessage, addBrief, findProjectBySlug } from '../db.mjs'

const NAME = 'multi-human-cast'
const PROJECT_TITLE = 'Test Cast — Cozy Italian Café (5b)'
const PROJECT_SLUG = 'test-cast-cafe'

// brief_role is what each person is *doing*; role is the access tier. Originator
// + Contributor are the focus (both chat with Sam in the same brief); Reviewer +
// Owner are seeded so role flows are testable later.
const CAST = [
  { key: 'originator',  email: 'test-originator@ibuild4you.com',  first: 'Mara',   last: 'O', role: 'maker',   brief_role: 'originator' },
  { key: 'contributor', email: 'test-contributor@ibuild4you.com', first: 'Tomas',  last: 'C', role: 'maker',   brief_role: 'contributor' },
  { key: 'reviewer',    email: 'test-reviewer@ibuild4you.com',    first: 'Renata', last: 'R', role: 'builder', brief_role: 'reviewer' },
  { key: 'owner',       email: 'test-owner@ibuild4you.com',       first: 'Olivia', last: 'W', role: 'owner',   brief_role: null },
]

const WELCOME_MESSAGE =
  "Hi! I'm Sam. I hear you're dreaming up a cozy Italian café in Seattle — tell me about it and who's working on it with you."

const BRIEF_CONTENT = {
  problem: 'No warm neighborhood café in the Fremont area of Seattle that feels genuinely Italian.',
  target_users: 'Local residents and remote workers who want a third place.',
  features: ['Espresso bar', 'Small pastry kitchen', 'Evening wine + aperitivo'],
  constraints: 'Small footprint storefront; tight opening budget.',
  additional_context: '',
  decisions: [],
}

function generatePasscode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function getOrCreateAuthUser(adminAuth, member, apply) {
  try {
    const u = await adminAuth.getUserByEmail(member.email)
    return u.uid
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err
    if (!apply) return '(would create)'
    const u = await adminAuth.createUser({
      email: member.email,
      displayName: `${member.first} ${member.last}`,
      emailVerified: true,
    })
    return u.uid
  }
}

async function findOrCreateProject(db, apply) {
  const existing = await findProjectBySlug(db, PROJECT_SLUG)
  if (existing) return { id: existing.id, created: false }
  if (!apply) return { id: '(would create)', created: true }
  const id = await makeProject(
    db,
    {
      title: PROJECT_TITLE,
      slug: PROJECT_SLUG,
      requester_email: CAST[0].email,
      requester_first_name: CAST[0].first,
      requester_last_name: CAST[0].last,
      context: 'Synthetic 5b multi-human test cast. Two makers (Originator + Contributor) chat with Sam in this one brief. Safe to delete when rotating.',
      welcome_message: WELCOME_MESSAGE,
    },
    NAME,
  )
  return { id, created: true }
}

// One active session + welcome message so both humans land on the same
// conversation. Idempotent: skip if the project already has any session.
async function ensureActiveSession(db, pid, apply) {
  const existing = await db.collection('sessions').where('project_id', '==', pid).limit(1).get()
  if (!existing.empty) return 'exists'
  if (!apply) return 'would-create'
  const sid = await addSession(db, pid, { welcome_message: WELCOME_MESSAGE }, NAME)
  await addMessage(db, sid, { role: 'agent', content: WELCOME_MESSAGE }, NAME)
  return 'created'
}

async function ensureBrief(db, pid, apply) {
  const existing = await db.collection('briefs').where('project_id', '==', pid).limit(1).get()
  if (!existing.empty) return 'exists'
  if (!apply) return 'would-create'
  await addBrief(db, pid, BRIEF_CONTENT, 1, NAME)
  return 'created'
}

async function upsertMembership(db, pid, member, uid, passcode, apply) {
  const existing = await db
    .collection('project_members')
    .where('project_id', '==', pid)
    .where('email', '==', member.email)
    .limit(1)
    .get()
  const now = iso()
  const payload = {
    project_id: pid,
    user_id: apply ? uid : '',
    email: member.email,
    role: member.role,
    brief_role: member.brief_role,
    passcode,
    added_by: 'seed-test-cast',
    updated_at: now,
    seed_tag: 'fixture',
    seed_scenario: NAME,
  }
  if (existing.empty) {
    if (!apply) return 'would-create'
    await db.collection('project_members').add({ ...payload, created_at: now })
    return 'created'
  }
  if (!apply) return 'would-rotate'
  await existing.docs[0].ref.update(payload)
  return 'rotated'
}

async function upsertUserDoc(db, uid, member, apply) {
  if (!apply || uid.startsWith('(')) return
  const now = iso()
  await db.collection('users').doc(uid).set(
    { email: member.email, first_name: member.first, last_name: member.last, source: 'seed-test-cast', updated_at: now, created_at: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

async function upsertApprovedEmail(db, member, apply) {
  if (!apply) return
  await db.collection('approved_emails').doc(member.email).set(
    { email: member.email, source: 'seed-test-cast', updated_at: iso() },
    { merge: true },
  )
}

async function seed({ db, adminAuth, apply, log }) {
  log(`Cast project: ${PROJECT_TITLE} (slug: ${PROJECT_SLUG})`)
  const project = await findOrCreateProject(db, apply)
  log(`Project: ${project.created ? 'create' : 'reuse'} → id=${project.id}`)
  log(`Active session: ${await ensureActiveSession(db, project.id, apply)}`)
  log(`Brief: ${await ensureBrief(db, project.id, apply)}`)

  const passcodeMap = {}
  for (const member of CAST) {
    const envKey = `SEED_PASSCODE_${member.key.toUpperCase()}`
    const passcode = (process.env[envKey]?.trim() || generatePasscode()).toUpperCase()
    passcodeMap[member.email] = passcode

    const uid = await getOrCreateAuthUser(adminAuth, member, apply)
    await upsertUserDoc(db, uid, member, apply)
    await upsertApprovedEmail(db, member, apply)
    const action = await upsertMembership(db, project.id, member, uid, passcode, apply)
    log(`  ${member.key.padEnd(11)} ${member.email.padEnd(34)} role=${member.role.padEnd(7)} brief_role=${member.brief_role ?? 'null'} → ${action}`)
  }

  if (apply) {
    const json = JSON.stringify(passcodeMap, null, 2)
    writeFileSync('.test-cast-passcodes.json', json + '\n')
    const r = spawnSync('pbcopy', { input: json })
    log('PASSCODES → .test-cast-passcodes.json (gitignored)' + (r.status === 0 ? ' + clipboard' : ' (pbcopy failed — read the file)'))
    log('Sign in at https://preview.ibuild4you.com/auth/login as each email + its passcode.')
  }
}

export const scenario = {
  name: NAME,
  description: 'Four-identity multi-human cast on one brief (5b: Sam mediating 2+ humans).',
  standard: true,
  seed,
}
