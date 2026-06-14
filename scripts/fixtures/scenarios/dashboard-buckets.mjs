// Scenario: seed the test admin's dashboard with one brief in each #44 section
// (Awaiting / Yours / Reviewing / Contributing / Done), so the sectioned layout
// renders. The grouping flattens below 4 briefs or with one non-empty bucket
// (lib/dashboard/group-briefs.ts), so the thin test cast can't exercise it.
//
// Cleanup is handled centrally by the runner via cleanAll({ scenario }); this
// module only describes seeding.

import {
  iso,
  makeProject,
  addSession,
  addMessage,
  addBrief,
  addMember,
  findProjectBySlug,
} from '../db.mjs'

const NAME = 'dashboard-buckets'
const ADMIN_EMAIL = 'test@ibuild4you.com'
const MAKER_EMAIL = 'dbtest-maker@ibuild4you.com'
const HOUR = 3600_000
const WELCOME = "Hi! I'm Sam. Tell me about what you're hoping to build."

// One spec per target section. requester/session/makerReplied/status shape the
// turn state; brief_role picks the role bucket when the brief isn't "awaiting".
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

async function seed({ db, adminAuth, apply, log }) {
  log(`Admin: ${ADMIN_EMAIL}`)
  const adminUid = await resolveAdminUid(adminAuth)
  for (const spec of SPECS) {
    const action = await seedOne(db, spec, adminUid, apply)
    log(`  ${spec.slug.padEnd(24)} brief_role=${spec.brief_role.padEnd(11)} → ${action}`)
  }
  if (apply) log(`Sign in at https://preview.ibuild4you.com/dashboard as ${ADMIN_EMAIL} to see the sections.`)
}

async function resolveAdminUid(adminAuth) {
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

async function seedOne(db, spec, adminUid, apply) {
  const existing = await findProjectBySlug(db, spec.slug)
  if (existing) {
    if (!apply) return `exists (id=${existing.id})`
    await addOrUpdateAdminMember(db, existing.id, adminUid, spec.brief_role)
    return `reuse (id=${existing.id})`
  }
  if (!apply) return 'would-create'

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
    NAME,
  )

  if (spec.session) {
    const sessionCreated = iso(HOUR) // opened an hour ago
    const sid = await addSession(
      db,
      pid,
      { status: spec.status === 'completed' ? 'completed' : 'active', welcome_message: WELCOME, created_at: sessionCreated },
      NAME,
    )
    await addMessage(db, sid, { role: 'agent', content: WELCOME, created_at: sessionCreated }, NAME)
    if (spec.makerReplied) {
      // A maker reply AFTER the session opened → getTurnIndicator = your_turn.
      await addMessage(
        db,
        sid,
        { role: 'user', sender_email: MAKER_EMAIL, content: 'Here are my thoughts so far!', created_at: iso(60_000) },
        NAME,
      )
    }
  }

  await addBrief(db, pid, BRIEF_CONTENT, 1, NAME)
  await addOrUpdateAdminMember(db, pid, adminUid, spec.brief_role)
  return `created (id=${pid})`
}

async function addOrUpdateAdminMember(db, pid, adminUid, briefRole) {
  const existing = await db
    .collection('project_members')
    .where('project_id', '==', pid)
    .where('user_id', '==', adminUid)
    .limit(1)
    .get()
  if (existing.empty) {
    await addMember(db, pid, { user_id: adminUid, email: ADMIN_EMAIL, role: 'builder', brief_role: briefRole }, NAME)
  } else {
    await existing.docs[0].ref.update({ brief_role: briefRole, role: 'builder', updated_at: iso() })
  }
}

export const scenario = {
  name: NAME,
  description: "One brief per #44 dashboard section for the test admin (verifies the sectioned layout).",
  standard: true, // included in `seed reset`
  seed,
}
