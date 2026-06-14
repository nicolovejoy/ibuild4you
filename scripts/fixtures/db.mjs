// Shared plumbing for preview test-data seed scripts (#44 follow-up).
//
// Before this, every seed script (seed-test-cast, seed-dashboard-buckets, …)
// re-implemented Firestore init, the preview-only write guard, and the
// project/session/message/member doc shapes by hand — six near-copies that
// drifted. This is the single source of truth for all of that.
//
// Every doc a builder writes carries seed_tag: 'fixture' (plus an optional
// seed_scenario), so cleanAll() can find and remove synthetic data reliably
// instead of guessing by slug prefix and deleting per-collection in order.
//
// Always run via scripts/with-preview-env.mjs so FIREBASE_SERVICE_ACCOUNT
// points at the preview sandbox.

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

export const SEED_TAG = 'fixture'

// Collections cleanAll sweeps, in delete-safe order (children before parents).
const FIXTURE_COLLECTIONS = ['messages', 'sessions', 'briefs', 'project_members', 'projects']

export const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString()

// Init the Admin SDK from FIREBASE_SERVICE_ACCOUNT. With requireWrite, refuses
// to proceed unless the service account targets the preview sandbox — the same
// guard every seed script needs, in one place.
export function initFixtureDb({ requireWrite = false } = {}) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!sa) {
    console.error('Set FIREBASE_SERVICE_ACCOUNT (use scripts/with-preview-env.mjs as wrapper)')
    process.exit(1)
  }
  let firebaseProjectId = ''
  try {
    firebaseProjectId = JSON.parse(sa).project_id || ''
  } catch {
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON')
    process.exit(1)
  }
  if (requireWrite && !firebaseProjectId.includes('preview')) {
    console.error(`Refusing to write: Firebase project is "${firebaseProjectId}", not the preview sandbox.`)
    process.exit(1)
  }
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
  return { db: getFirestore(), adminAuth: getAuth(), firebaseProjectId }
}

// Stamp seed_tag (+ optional seed_scenario) onto a doc body.
function tag(fields, scenario) {
  return { ...fields, seed_tag: SEED_TAG, ...(scenario && { seed_scenario: scenario }) }
}

// --- Doc builders: the canonical synthetic doc shapes, one place. ---
// Each merges sensible defaults, then caller `fields`, then the seed tag.

export async function makeProject(db, fields, scenario) {
  const now = iso()
  const ref = await db.collection('projects').add(
    tag(
      {
        status: 'active',
        session_mode: 'discover',
        auto_reminders_enabled: false,
        reminders_sent_count: 0,
        last_reminder_sent_at: null,
        created_at: now,
        updated_at: now,
        ...fields,
      },
      scenario,
    ),
  )
  return ref.id
}

export async function addSession(db, projectId, fields = {}, scenario) {
  const created = fields.created_at || iso()
  const ref = await db.collection('sessions').add(
    tag(
      {
        project_id: projectId,
        status: 'active',
        session_mode: 'discover',
        created_at: created,
        updated_at: created,
        ...fields,
      },
      scenario,
    ),
  )
  return ref.id
}

export async function addMessage(db, sessionId, fields, scenario) {
  const now = fields.created_at || iso()
  await db.collection('messages').add(
    tag({ session_id: sessionId, created_at: now, updated_at: now, ...fields }, scenario),
  )
}

export async function addBrief(db, projectId, content, version = 1, scenario) {
  const now = iso()
  await db.collection('briefs').add(
    tag({ project_id: projectId, version, content, created_at: now, updated_at: now }, scenario),
  )
}

export async function addMember(db, projectId, fields, scenario) {
  const now = iso()
  await db.collection('project_members').add(
    tag({ project_id: projectId, added_by: 'fixtures', created_at: now, updated_at: now, ...fields }, scenario),
  )
}

// Find a fixture project by slug (for idempotent re-seeds). Returns the
// QueryDocumentSnapshot or null.
export async function findProjectBySlug(db, slug) {
  const snap = await db.collection('projects').where('slug', '==', slug).limit(1).get()
  return snap.empty ? null : snap.docs[0]
}

// Delete every fixture-tagged doc. Pass { scenario } to scope to one scenario;
// omit to wipe all fixtures. Filters seed_scenario in memory so no composite
// index is needed (preview collections are small). Returns per-collection counts.
export async function cleanAll(db, { scenario } = {}) {
  const counts = {}
  for (const c of FIXTURE_COLLECTIONS) {
    const snap = await db.collection(c).where('seed_tag', '==', SEED_TAG).get()
    const docs = scenario ? snap.docs.filter((d) => d.data().seed_scenario === scenario) : snap.docs
    for (const d of docs) await d.ref.delete()
    counts[c] = docs.length
  }
  return counts
}
