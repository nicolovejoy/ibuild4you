#!/usr/bin/env node
// Backdate the test-cast session so the agent kickoff (#31) is guaranteed to
// fire on next open. Kickoff requires: last message is the agent's, prior maker
// history exists, and the gap since the last maker message is >= 1hr. After a
// fresh e2e run the gap is often too small (or a kickoff already fired), so this
// pushes the latest maker message + project.last_maker_message_at back in time
// and clears the session's last_kickoff_at guard.
//
// Preview only. Run via the env wrapper:
//   node scripts/with-preview-env.mjs node scripts/backdate-cast-session.mjs            # dry-run
//   node scripts/with-preview-env.mjs node scripts/backdate-cast-session.mjs --apply    # write

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')
const PROJECT_SLUG = 'test-cast-cafe'
const HOURS_AGO = 25 // -> humanizeGap "about a day", so the recap is visible

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (use scripts/with-preview-env.mjs as wrapper)')
  process.exit(1)
}
const firebaseProjectId = (() => {
  try {
    return JSON.parse(sa).project_id || ''
  } catch {
    return ''
  }
})()
if (APPLY && !firebaseProjectId.includes('preview')) {
  console.error(`Refusing to --apply: Firebase project is "${firebaseProjectId}", not the preview sandbox.`)
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const projSnap = await db.collection('projects').where('slug', '==', PROJECT_SLUG).limit(1).get()
if (projSnap.empty) {
  console.error(`No project with slug "${PROJECT_SLUG}" on ${firebaseProjectId}`)
  process.exit(1)
}
const projDoc = projSnap.docs[0]
const projectId = projDoc.id

// Active session (fall back to most recent by created_at)
const sessSnap = await db.collection('sessions').where('project_id', '==', projectId).get()
if (sessSnap.empty) {
  console.error('No sessions on the cast project')
  process.exit(1)
}
const sessions = sessSnap.docs.sort((a, b) => (a.data().created_at || '').localeCompare(b.data().created_at || ''))
const session = sessions.find((s) => s.data().status === 'active') || sessions[sessions.length - 1]
const sessionId = session.id

const msgSnap = await db.collection('messages').where('session_id', '==', sessionId).get()
const messages = msgSnap.docs.sort((a, b) => (a.data().created_at || '').localeCompare(b.data().created_at || ''))
if (messages.length === 0) {
  console.error('Session has no messages')
  process.exit(1)
}

const last = messages[messages.length - 1].data()
const makerMsgs = messages.filter((m) => m.data().role === 'user')

const target = new Date(Date.now() - HOURS_AGO * 60 * 60 * 1000).toISOString()

console.log(`project=${projectId} session=${sessionId} messages=${messages.length} makerMessages=${makerMsgs.length}`)
console.log(`last message role: ${last.role}`)
if (last.role !== 'agent') {
  console.log('⚠️  Last message is the maker\'s — kickoff will NOT fire by design (maker is mid-turn).')
  console.log('    Backdating anyway, but the session needs an agent message last to trigger.')
}
if (makerMsgs.length === 0) {
  console.log('⚠️  No maker messages — kickoff fires only on returning-after-a-break. Nothing to backdate.')
  process.exit(0)
}

const latestMaker = makerMsgs[makerMsgs.length - 1]
console.log(`\nWould set:`)
console.log(`  messages/${latestMaker.id}.created_at -> ${target}`)
console.log(`  projects/${projectId}.last_maker_message_at -> ${target}`)
console.log(`  sessions/${sessionId}.last_kickoff_at -> null (cleared)`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

await db.collection('messages').doc(latestMaker.id).update({ created_at: target })
await db.collection('projects').doc(projectId).update({ last_maker_message_at: target })
await db.collection('sessions').doc(sessionId).update({ last_kickoff_at: null })

console.log('\n✅ Backdated. Open the brief on preview to see the kickoff greet you.')
