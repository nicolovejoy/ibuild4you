#!/usr/bin/env node
// Seed a "waiting on maker" brief on preview to verify #21 (reminder copy +
// card placement). State produced: a brief with an invited maker (first name
// "Sam") and 3 conversations where the newest is active with NO maker reply —
// exactly the condition that renders the "Waiting on …" card. session_count=3
// so the in-app reminder shows "(#3)".
//
// Idempotent: wipes the 'waiting-reminder' scenario first, then recreates.
// Preview only. Run via:
//   node scripts/with-preview-env.mjs node scripts/seed-waiting-brief.mjs --apply

import { initFixtureDb, cleanAll, makeProject, addSession, addMessage, addMember, iso } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')
const SCENARIO = 'waiting-reminder'
const SLUG = 'test-waiting-reminder'

const CLEAN = process.argv.includes('--clean')

const { db, adminAuth, firebaseProjectId } = initFixtureDb({ requireWrite: APPLY || CLEAN })

if (CLEAN) {
  const wiped = await cleanAll(db, { scenario: SCENARIO })
  console.log(`Cleaned scenario "${SCENARIO}":`, wiped)
  process.exit(0)
}

if (!APPLY) {
  console.log(`Dry run (no writes). Firebase project: ${firebaseProjectId}`)
  console.log(`Would wipe scenario "${SCENARIO}" then create brief slug "${SLUG}" in waiting-on-maker state.`)
  process.exit(0)
}

// Owner = the test admin, so the brief is reachable in its builder view.
let ownerUid = 'fixtures'
try {
  ownerUid = (await adminAuth.getUserByEmail('test@ibuild4you.com')).uid
} catch {
  console.log('⚠️  test@ibuild4you.com not found in Auth; owner membership uses placeholder uid.')
}

const wiped = await cleanAll(db, { scenario: SCENARIO })
console.log('wiped:', wiped)

const now = Date.now()
const projectId = await makeProject(
  db,
  {
    title: 'Waiting Reminder Test',
    slug: SLUG,
    requester_email: 'sam@example.com',
    requester_first_name: 'Sam',
    requester_last_name: 'Lee',
    shared_at: iso(7 * 86400000),
    last_maker_message_at: iso(3 * 86400000),
    latest_session_created_at: iso(60000),
    session_count: 3,
  },
  SCENARIO,
)

await addMember(db, projectId, { uid: ownerUid, email: 'test@ibuild4you.com', role: 'owner', brief_role: 'originator' }, SCENARIO)

// Two completed conversations (older), then the active unanswered one (newest).
const s1 = await addSession(db, projectId, { status: 'completed', created_at: iso(6 * 86400000) }, SCENARIO)
await addMessage(db, s1, { role: 'agent', content: 'Welcome — tell me about your cafe.', created_at: iso(6 * 86400000) }, SCENARIO)
await addMessage(db, s1, { role: 'user', content: 'It is a small neighbourhood cafe.', created_at: iso(6 * 86400000 - 1000) }, SCENARIO)

const s2 = await addSession(db, projectId, { status: 'completed', created_at: iso(4 * 86400000) }, SCENARIO)
await addMessage(db, s2, { role: 'agent', content: 'Good to see you again.', created_at: iso(4 * 86400000) }, SCENARIO)
await addMessage(db, s2, { role: 'user', content: 'We want online ordering.', created_at: iso(4 * 86400000 - 1000) }, SCENARIO)

// Active conversation #3: only an agent message, no maker reply -> waiting.
const s3 = await addSession(db, projectId, { status: 'active', created_at: iso(60000) }, SCENARIO)
await addMessage(db, s3, { role: 'agent', content: 'Ready to pick up where we left off whenever you are.', created_at: iso(60000) }, SCENARIO)

console.log(`\n✅ Seeded waiting-on-maker brief`)
console.log(`   project=${projectId} slug=${SLUG} sessions=3 (active #3 unanswered)`)
console.log(`   open: https://preview.ibuild4you.com/projects/${SLUG}`)
