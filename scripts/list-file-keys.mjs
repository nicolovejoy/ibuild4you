#!/usr/bin/env node
// Dump every storage_path from the `files` collection of whichever Firestore
// the FIREBASE_SERVICE_ACCOUNT points at. Used to audit S3 orphans: a key in
// the bucket referenced by no files doc (in prod OR preview) is an orphan.
//
// Usage:
//   node scripts/with-prod-env-ro.mjs node scripts/list-file-keys.mjs
//   node scripts/with-preview-env.mjs node scripts/list-file-keys.mjs

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (use a with-*-env wrapper)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const snap = await db.collection('files').get()
for (const doc of snap.docs) {
  const sp = doc.data().storage_path
  if (sp) console.log(sp)
}
console.error(`# ${snap.size} files docs (project: ${JSON.parse(sa).project_id})`)
