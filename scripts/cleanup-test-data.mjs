/**
 * Clean up test data left over from JSON import testing.
 *
 * Finds every project tied to test@example.com (as requester OR member),
 * plus the approved_emails doc and any users doc for that email, then
 * deletes the project + all its sessions, messages, briefs, files (Firestore
 * docs and S3 objects), and memberships.
 *
 * Defaults to dry-run. Pass --apply to actually delete. Pass --email <addr>
 * to target a different test email (still must end in @example.com — guard
 * against accidentally pointing this at a real user).
 *
 * Usage:
 *   node --env-file=.env.local scripts/cleanup-test-data.mjs
 *   node --env-file=.env.local scripts/cleanup-test-data.mjs --apply
 *   node --env-file=.env.local scripts/cleanup-test-data.mjs --email foo@example.com --apply
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'

const APPLY = process.argv.includes('--apply')
const emailIdx = process.argv.indexOf('--email')
const TARGET_EMAIL = (emailIdx >= 0 ? process.argv[emailIdx + 1] : 'test@example.com').toLowerCase()

if (!TARGET_EMAIL.endsWith('@example.com')) {
  console.error(`Refusing to run: --email must end in @example.com (got "${TARGET_EMAIL}"). This is a safety guard against pointing this script at real users.`)
  process.exit(1)
}

function initAdmin() {
  if (getApps().length === 0) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT not set (run with `node --env-file=.env.local ...`)')
    initializeApp({ credential: cert(JSON.parse(sa)) })
  }
}

initAdmin()
const db = getFirestore()
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
const S3_BUCKET = process.env.AWS_S3_BUCKET || 'ibuild4you-files'

function banner(text) {
  console.log(`\n=== ${text} ===`)
}

async function findTargetProjectIds() {
  const ids = new Set()

  const byRequester = await db.collection('projects').where('requester_email', '==', TARGET_EMAIL).get()
  byRequester.forEach((d) => ids.add(d.id))

  const byMember = await db.collection('project_members').where('email', '==', TARGET_EMAIL).get()
  byMember.forEach((d) => {
    const pid = d.data().project_id
    if (pid) ids.add(pid)
  })

  return [...ids]
}

async function collectProjectArtifacts(projectId) {
  const projectDoc = await db.collection('projects').doc(projectId).get()
  const project = projectDoc.exists ? projectDoc.data() : null

  const sessionsSnap = await db.collection('sessions').where('project_id', '==', projectId).get()
  const sessionIds = sessionsSnap.docs.map((d) => d.id)

  // Messages are keyed by session_id, not project_id. Fetch per session.
  const messageDocs = []
  for (const sid of sessionIds) {
    const snap = await db.collection('messages').where('session_id', '==', sid).get()
    snap.forEach((d) => messageDocs.push(d))
  }

  const briefsSnap = await db.collection('briefs').where('project_id', '==', projectId).get()
  const filesSnap = await db.collection('files').where('project_id', '==', projectId).get()
  const membersSnap = await db.collection('project_members').where('project_id', '==', projectId).get()

  // Defensive: refuse to touch a project that has members outside our target
  // email. JSON-import tests should only ever produce single-member test
  // projects; a non-test member means we picked something up by accident.
  const foreignMembers = membersSnap.docs.filter((d) => {
    const e = (d.data().email || '').toLowerCase()
    return e && e !== TARGET_EMAIL
  })

  return {
    projectId,
    project,
    sessionIds,
    sessionDocs: sessionsSnap.docs,
    messageDocs,
    briefDocs: briefsSnap.docs,
    fileDocs: filesSnap.docs,
    memberDocs: membersSnap.docs,
    foreignMembers,
  }
}

async function deleteDocsBatched(refs) {
  // Firestore batch limit is 500 ops
  const CHUNK = 400
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = db.batch()
    refs.slice(i, i + CHUNK).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}

async function deleteS3Object(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
}

async function deleteProject(art) {
  // S3 first — if Firestore deletes succeed but S3 fails, we lose the keys
  // we needed. Going the other way (S3 first) means a partial S3 delete still
  // leaves Firestore docs to retry, which is the recoverable direction.
  for (const fileDoc of art.fileDocs) {
    const key = fileDoc.data().storage_path
    if (key) {
      try {
        await deleteS3Object(key)
      } catch (err) {
        console.error(`  ! S3 delete failed for ${key}:`, err.message)
        throw err
      }
    }
  }

  await deleteDocsBatched(art.messageDocs.map((d) => d.ref))
  await deleteDocsBatched(art.sessionDocs.map((d) => d.ref))
  await deleteDocsBatched(art.fileDocs.map((d) => d.ref))
  await deleteDocsBatched(art.briefDocs.map((d) => d.ref))
  await deleteDocsBatched(art.memberDocs.map((d) => d.ref))
  await db.collection('projects').doc(art.projectId).delete()
}

async function main() {
  banner(APPLY ? `APPLY — deleting test data for ${TARGET_EMAIL}` : `DRY RUN — preview test data cleanup for ${TARGET_EMAIL}`)

  const projectIds = await findTargetProjectIds()
  console.log(`Found ${projectIds.length} project(s) tied to ${TARGET_EMAIL}.`)

  const artifacts = []
  for (const pid of projectIds) {
    const art = await collectProjectArtifacts(pid)
    artifacts.push(art)
  }

  let totalMsgs = 0, totalSessions = 0, totalFiles = 0, totalBriefs = 0, totalMembers = 0, totalS3 = 0
  let blocked = false

  for (const art of artifacts) {
    const title = art.project?.title || '(deleted project doc)'
    console.log(`\n  Project ${art.projectId}  —  "${title}"`)
    console.log(`    sessions:        ${art.sessionDocs.length}`)
    console.log(`    messages:        ${art.messageDocs.length}`)
    console.log(`    files (Firestore): ${art.fileDocs.length}`)
    const s3Keys = art.fileDocs.map((d) => d.data().storage_path).filter(Boolean)
    console.log(`    files (S3 keys):   ${s3Keys.length}`)
    console.log(`    briefs:          ${art.briefDocs.length}`)
    console.log(`    members:         ${art.memberDocs.length}`)
    totalSessions += art.sessionDocs.length
    totalMsgs += art.messageDocs.length
    totalFiles += art.fileDocs.length
    totalBriefs += art.briefDocs.length
    totalMembers += art.memberDocs.length
    totalS3 += s3Keys.length

    if (art.foreignMembers.length > 0) {
      blocked = true
      console.log(`    !! BLOCKED: project also has ${art.foreignMembers.length} non-test member(s):`)
      for (const m of art.foreignMembers) {
        console.log(`         ${m.data().email}  (role=${m.data().role})`)
      }
    }
  }

  // Standalone items not tied to a project
  const approvedRef = db.collection('approved_emails').doc(TARGET_EMAIL)
  const approvedDoc = await approvedRef.get()
  console.log(`\n  approved_emails/${TARGET_EMAIL}: ${approvedDoc.exists ? 'present' : 'absent'}`)

  const usersSnap = await db.collection('users').where('email', '==', TARGET_EMAIL).get()
  console.log(`  users with email=${TARGET_EMAIL}: ${usersSnap.size}`)

  console.log(`\nTotals across all target projects:`)
  console.log(`  ${totalSessions} sessions, ${totalMsgs} messages, ${totalFiles} files (${totalS3} S3 keys), ${totalBriefs} briefs, ${totalMembers} members`)

  if (blocked) {
    console.error(`\nRefusing to apply: one or more projects has non-test members. Investigate before proceeding.`)
    process.exit(1)
  }

  if (!APPLY) {
    console.log(`\n(dry run — pass --apply to delete)`)
    return
  }

  banner('Deleting')
  for (const art of artifacts) {
    console.log(`  Deleting project ${art.projectId}…`)
    await deleteProject(art)
    console.log(`    done.`)
  }

  if (approvedDoc.exists) {
    await approvedRef.delete()
    console.log(`  Deleted approved_emails/${TARGET_EMAIL}`)
  }

  for (const userDoc of usersSnap.docs) {
    await userDoc.ref.delete()
    console.log(`  Deleted users/${userDoc.id}`)
  }

  console.log(`\nDone.`)
}

main().catch((err) => { console.error(err); process.exit(1) })
