#!/usr/bin/env node
// List projects (slug + title + id), optionally filtered by a substring match
// against slug or title. Handy when a host app embedding the feedback widget
// needs to know the exact projects.slug to send as projectId.
//
// Usage:
//   node scripts/with-prod-env.mjs node scripts/list-projects.mjs
//   node scripts/with-prod-env.mjs node scripts/list-projects.mjs --grep prntd

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const grepIdx = process.argv.indexOf('--grep')
const GREP = grepIdx >= 0 ? process.argv[grepIdx + 1]?.toLowerCase() : null

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const snap = await db.collection('projects').get()
let rows = snap.docs.map((d) => ({
  id: d.id,
  slug: d.data().slug || '(no slug)',
  title: d.data().title || '(no title)',
  repo: d.data().github_repo || '',
}))
if (GREP) {
  rows = rows.filter(
    (r) => r.slug.toLowerCase().includes(GREP) || r.title.toLowerCase().includes(GREP)
  )
}
rows.sort((a, b) => a.slug.localeCompare(b.slug))

console.log(`projects${GREP ? ` matching "${GREP}"` : ''}: ${rows.length}\n`)
console.log(`${'slug'.padEnd(32)}  ${'title'.padEnd(40)}  ${'github_repo'.padEnd(28)}  id`)
for (const r of rows) {
  console.log(
    `${r.slug.padEnd(32)}  ${r.title.slice(0, 40).padEnd(40)}  ${r.repo.padEnd(28)}  ${r.id}`
  )
}
