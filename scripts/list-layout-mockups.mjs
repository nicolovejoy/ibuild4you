#!/usr/bin/env node
// Read-only: list projects whose layout_mockups field is non-empty, and count
// messages that contain a ```wireframe fence. Decides whether #195 phase 2
// (full wireframe removal) would strand any live data.
//
// Usage (prod, read-only):
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs \
//     node scripts/list-layout-mockups.mjs

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const projects = await db.collection('projects').get()
let withMockups = 0
for (const d of projects.docs) {
  const m = d.data().layout_mockups
  if (Array.isArray(m) && m.length > 0) {
    withMockups += 1
    console.log(`project ${d.id}  slug=${d.data().slug}  mockups=${m.length}`)
  }
}
console.log(`projects: ${projects.size}, with layout_mockups: ${withMockups}`)

// Messages are many; scan content for the fence marker only.
const messages = await db.collection('messages').select('content').get()
let fenced = 0
for (const d of messages.docs) {
  const c = d.data().content
  if (typeof c === 'string' && c.includes('```wireframe')) fenced += 1
}
console.log(`messages: ${messages.size}, with wireframe fence: ${fenced}`)
