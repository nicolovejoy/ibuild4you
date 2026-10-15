#!/usr/bin/env node
// Read-only: find project memberships by first name or email fragment, and
// print each with its project slug. Used to look up the address and brief
// for a Garm alias check.
//
// Usage (prod, read-only):
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs \
//     node scripts/find-member.mjs scott

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const needle = (process.argv[2] || '').toLowerCase()
if (!needle) {
  console.error('Usage: find-member.mjs <name-or-email-fragment>')
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const projects = new Map()
for (const d of (await db.collection('projects').get()).docs) {
  projects.set(d.id, d.data().slug || d.data().title || d.id)
}

const members = await db.collection('project_members').get()
let n = 0
for (const d of members.docs) {
  const m = d.data()
  const hay = `${m.email || ''} ${m.first_name || ''} ${m.last_name || ''}`.toLowerCase()
  if (!hay.includes(needle)) continue
  n += 1
  console.log(
    `${(m.email || '?').padEnd(36)} ${(m.role || '?').padEnd(10)} ` +
      `${projects.get(m.project_id) || m.project_id}`
  )
}
console.log(`\n${n} membership(s) matched "${needle}"`)
