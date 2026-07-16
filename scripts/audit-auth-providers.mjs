#!/usr/bin/env node
// Admin audit: lists every active brief member's email + their Firebase Auth
// providers (password? google.com? none — passcode-only?) so Nico can see
// who's migrated off passcodes and nudge stragglers personally (Garm PR B).
//
// Read-only. Reads project_members (Firestore) and looks each distinct email
// up in Firebase Auth (adminAuth.getUserByEmail) — never mutates anything.
//
// Note on which env wrapper to use: Firestore reads work fine under the
// datastore.viewer-scoped FIREBASE_SERVICE_ACCOUNT_RO key (with-prod-env-ro.mjs).
// The Firebase Auth Admin lookups (getUserByEmail) are a separate API surface
// (Identity Toolkit, not Firestore) — if the RO key 403s on those calls, fall
// back to the full-access with-prod-env.mjs. Either way this script only ever
// reads.
//
// Usage:
//   node scripts/with-prod-env-ro.mjs node scripts/audit-auth-providers.mjs
//   node scripts/with-prod-env.mjs node scripts/audit-auth-providers.mjs   (if RO 403s on Auth lookups)

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { activeMemberEmails, providerFlags } from './lib/audit-auth-providers-plan.mjs'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via scripts/with-prod-env-ro.mjs or with-prod-env.mjs)')
  process.exit(1)
}
const app = initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore(app)
const adminAuth = getAuth(app)

const snap = await db.collection('project_members').get()
const members = snap.docs.map((d) => ({
  email: d.data().email ?? '',
  removed_at: d.data().removed_at ?? null,
}))

const emails = activeMemberEmails(members)

const rows = []
for (const email of emails) {
  let flags
  try {
    const user = await adminAuth.getUserByEmail(email)
    flags = providerFlags(user.providerData)
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') {
      flags = providerFlags(null)
    } else {
      flags = { password: false, google: false, none: true, status: `error: ${err.message ?? err}` }
    }
  }
  rows.push({ email, ...flags })
}

console.log(`active member emails: ${rows.length}\n`)
console.log(`${'email'.padEnd(36)}  password  google  status`)
for (const r of rows) {
  console.log(
    `${r.email.padEnd(36)}  ${(r.password ? 'yes' : 'no').padEnd(8)}  ${(r.google ? 'yes' : 'no').padEnd(6)}  ${r.status}`
  )
}

const migrated = rows.filter((r) => r.password || r.google).length
console.log(`\n${migrated}/${rows.length} migrated off passcode-only`)
