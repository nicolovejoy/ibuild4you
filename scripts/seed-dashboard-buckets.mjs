#!/usr/bin/env node
// Seed the test admin's PREVIEW dashboard with one brief in each #44 section,
// so the sectioned layout (Awaiting / Yours / Reviewing / Contributing / Done)
// actually renders. The grouping logic flattens to a plain list below 4 briefs
// or with a single non-empty bucket (lib/dashboard/group-briefs.ts), so the
// thin test cast can't exercise it — this fills the gap.
//
// Each brief gets a project_members row for test@ibuild4you.com carrying the
// brief_role + a turn-state shaped by its data:
//   awaiting (your turn) — requester + session + a maker reply after open
//   awaiting (needs setup) — no requester_email, no session
//   yours / reviewing / contributing — requester + session, no maker reply yet
//   done — status: completed
//
// Run via the preview env wrapper (NEVER prod — writes synthetic briefs):
//   node scripts/with-preview-env.mjs node scripts/seed-dashboard-buckets.mjs            # dry-run
//   node scripts/with-preview-env.mjs node scripts/seed-dashboard-buckets.mjs --apply    # write
//   node scripts/with-preview-env.mjs node scripts/seed-dashboard-buckets.mjs --clean    # remove
//
// Idempotent: keyed on slug. --clean removes only this scenario's fixtures.

import {
  initFixtureDb,
  iso,
  makeProject,
  addSession,
  addMessage,
  addBrief,
  addMember,
  findProjectBySlug,
  cleanAll,
} from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')
const CLEAN = process.argv.includes('--clean')

const SCENARIO = 'dashboard-buckets'
const ADMIN_EMAIL = 'test@ibuild4you.com'
const MAKER_EMAIL = 'dbtest-maker@ibuild4you.com'
const HOUR = 3600_000
const WELCOME = "Hi! I'm Sam. Tell me about what you're hoping to build."

// One spec per target section. `requester`/`session`/`makerReplied`/`status`
// shape the turn state; `brief_role` picks the role bucket when not awaiting.
const SPECS = [
  { slug: 'dbtest-awaiting-turn',  title: '▸ DBTEST · Awaiting (your turn)',   brief_role: 'reviewer',    requester: true,  session: true,  makerReplied: true,  status: 'active' },
  { slug: 'dbtest-awaiting-setup', title: '▸ DBTEST · Awaiting (needs setup)', brief_role: 'originator',  requester: false, session: false, makerReplied: false, status: 'active' },
  { slug: 'dbtest-yours',          title: '▸ DBTEST · Yours',                  brief_role: 'originator',  requester: true,  session: true,  makerReplied: false, status: 'active' },
  { slug: 'dbtest-reviewing',      title: '▸ DBTEST · Reviewing',              brief_role: 'reviewer',    requester: true,  session: true,  makerReplied: false, status: 'active' },
  { slug: 'dbtest-contributing',   title: '▸ DBTEST · Contributing',           brief_role: 'contributor', requester: true,  session: true,  makerReplied: false, status: 'active' },
  { slug: 'dbtest-done',           title: '▸ DBTEST · Done',                   brief_role: 'originator',  requester: true,  session: true,  makerReplied: false, status: 'completed' },
]

const BRIEF_CONTENT = {
  problem: 'Placeholder problem for the dashboard fixture.',
  target_users: 'Placeholder users.',
  features: ['Feature one', 'Feature two'],
  constraints: '',
  additional_context: '',
  decisions: [],
}

const { db, adminAuth, firebaseProjectId } = initFixtureDb({ requireWrite: APPLY || CLEAN })
console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)

if (CLEAN) {
  const counts = await cleanAll(db, { scenario: SCENARIO })
  console.log(`Cleaned dashboard-buckets fixtures: ${JSON.stringify(counts)}`)
  process.exit(0)
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log(`Admin: ${ADMIN_EMAIL}`)
console.log()

const adminUid = await getAdminUid()
for (const spec of SPECS) {
  const action = await seedOne(spec, adminUid)
  console.log(`  ${spec.slug.padEnd(24)} brief_role=${spec.brief_role.padEnd(11)} → ${action}`)
}
console.log()
console.log(APPLY
  ? `Done. Sign in at https://preview.ibuild4you.com/dashboard as ${ADMIN_EMAIL} to see the sections.`
  : 'Dry-run complete. Re-run with --apply to write.')
process.exit(0)

async function getAdminUid() {
  try {
    return (await adminAuth.getUserByEmail(ADMIN_EMAIL)).uid
  } catch (err) {
    if (err?.code === 'auth/user-not-found') {
      console.error(`No auth user for ${ADMIN_EMAIL}. Run scripts/seed-test-admin.mjs first.`)
      process.exit(1)
    }
    throw err
  }
}

async function seedOne(spec, adminUid) {
  const existing = await findProjectBySlug(db, spec.slug)
  if (existing) {
    if (!APPLY) return `exists (id=${existing.id})`
    await addOrUpdateAdminMember(existing.id, adminUid, spec.brief_role)
    return `reuse (id=${existing.id})`
  }
  if (!APPLY) return 'would-create'

  const pid = await makeProject(
    db,
    {
      title: spec.title,
      slug: spec.slug,
      status: spec.status,
      ...(spec.requester && {
        requester_email: MAKER_EMAIL,
        requester_first_name: 'Dana',
        requester_last_name: 'M',
      }),
      context: 'Synthetic #44 dashboard-bucket fixture. Safe to delete (--clean).',
      welcome_message: WELCOME,
    },
    SCENARIO,
  )

  if (spec.session) {
    const sessionCreated = iso(HOUR) // opened an hour ago
    const sid = await addSession(
      db,
      pid,
      {
        status: spec.status === 'completed' ? 'completed' : 'active',
        welcome_message: WELCOME,
        created_at: sessionCreated,
      },
      SCENARIO,
    )
    await addMessage(db, sid, { role: 'agent', content: WELCOME, created_at: sessionCreated }, SCENARIO)
    if (spec.makerReplied) {
      // A maker reply AFTER the session opened → getTurnIndicator = your_turn.
      await addMessage(
        db,
        sid,
        { role: 'user', sender_email: MAKER_EMAIL, content: 'Here are my thoughts so far!', created_at: iso(60_000) },
        SCENARIO,
      )
    }
  }

  await addBrief(db, pid, BRIEF_CONTENT, 1, SCENARIO)
  await addOrUpdateAdminMember(pid, adminUid, spec.brief_role)
  return `created (id=${pid})`
}

async function addOrUpdateAdminMember(pid, adminUid, briefRole) {
  const existing = await db
    .collection('project_members')
    .where('project_id', '==', pid)
    .where('user_id', '==', adminUid)
    .limit(1)
    .get()
  if (existing.empty) {
    await addMember(
      db,
      pid,
      { user_id: adminUid, email: ADMIN_EMAIL, role: 'builder', brief_role: briefRole },
      SCENARIO,
    )
  } else {
    await existing.docs[0].ref.update({ brief_role: briefRole, role: 'builder', updated_at: iso() })
  }
}
