#!/usr/bin/env node
// Admin fix-it: reopen a prior conversation that was displaced when a new
// (empty) session was triggered by accident. NON-DESTRUCTIVE — the displaced
// empty session is *archived* (status='archived' + archived_at), never deleted,
// and the script REFUSES to archive any session that has messages.
//
// Mirrors the curated "Reopen previous conversation" admin operation. Writes an
// audit row to `admin_actions`.
//
//   node scripts/with-prod-env.mjs node scripts/fix-reopen-conversation.mjs \
//     --project <id> --reopen <sessionId> --archive <sessionId>          # dry-run
//   ... --apply                                                          # write
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes('--apply')
const projectId = arg('project')
const reopenId = arg('reopen')
const archiveId = arg('archive')
const actor = arg('actor') || 'fix-reopen-conversation.mjs'

if (!projectId || !reopenId) {
  console.error('Required: --project <id> --reopen <sessionId> [--archive <sessionId>]')
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('No FIREBASE_SERVICE_ACCOUNT (run via with-prod-env.mjs)'); process.exit(1) }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const now = new Date().toISOString()

async function msgCount(sessionId) {
  const s = await db.collection('messages').where('session_id', '==', sessionId).get()
  return s.size
}

const projRef = db.collection('projects').doc(projectId)
const proj = await projRef.get()
if (!proj.exists) { console.error(`Project ${projectId} not found`); process.exit(1) }

const reopenRef = db.collection('sessions').doc(reopenId)
const reopen = await reopenRef.get()
if (!reopen.exists || reopen.data().project_id !== projectId) {
  console.error(`Reopen session ${reopenId} not found in project ${projectId}`); process.exit(1)
}

let archiveRef = null
if (archiveId) {
  archiveRef = db.collection('sessions').doc(archiveId)
  const archive = await archiveRef.get()
  if (!archive.exists || archive.data().project_id !== projectId) {
    console.error(`Archive session ${archiveId} not found in project ${projectId}`); process.exit(1)
  }
  const n = await msgCount(archiveId)
  if (n > 0) {
    console.error(`REFUSING: session ${archiveId} has ${n} messages — non-destructive guard. Archive only empties.`)
    process.exit(1)
  }
}

// Recompute denormalized counters from the post-change session set: all sessions
// for the project minus the one being archived.
const allSessions = (await db.collection('sessions').where('project_id', '==', projectId).get()).docs
  .map((d) => ({ id: d.id, ...d.data() }))
const surviving = allSessions.filter((s) => s.id !== archiveId)
const sessionCount = surviving.length
const latest = surviving
  .map((s) => String(s.created_at))
  .sort()
  .at(-1)

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
console.log(`Project: ${proj.data().title} (${projectId})`)
console.log(`  reopen  ${reopenId}: status '${reopen.data().status}' -> 'active'`)
if (archiveRef) console.log(`  archive ${archiveId}: status -> 'archived' (+archived_at)  [empty, verified]`)
console.log(`  session_count -> ${sessionCount}; latest_session_created_at -> ${latest}`)

if (!APPLY) { console.log('\nDry-run only. Re-run with --apply to write.'); process.exit(0) }

const batch = db.batch()
batch.update(reopenRef, { status: 'active', updated_at: now })
if (archiveRef) batch.update(archiveRef, { status: 'archived', archived_at: now, updated_at: now })
batch.update(projRef, { session_count: sessionCount, latest_session_created_at: latest, updated_at: now })
batch.set(db.collection('admin_actions').doc(), {
  action: 'reopen_conversation',
  actor,
  project_id: projectId,
  reopened_session_id: reopenId,
  archived_session_id: archiveId || null,
  created_at: now,
})
await batch.commit()
console.log('\nApplied. Audit row written to admin_actions.')
