#!/usr/bin/env node
// Read-only: counts Firebase Auth accounts by email_verified and sign-in
// provider, then lists every account whose address is NOT verified, with what
// it can reach (live project memberships, approved_emails row). Written before
// enforcing email_verified at sign-in: anyone on the unverified list would be
// locked out by that check, so the list must be understood first.
//
// Usage (prod, read-only):
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/audit-unverified-auth.mjs

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

// Every Auth account, paged.
const users = []
let pageToken
do {
  const page = await getAuth().listUsers(1000, pageToken)
  users.push(...page.users)
  pageToken = page.pageToken
} while (pageToken)

const providersOf = (u) => u.providerData.map((p) => p.providerId).sort().join('+') || '(none)'

// Counts by verified × providers.
const counts = new Map()
for (const u of users) {
  const key = `${u.emailVerified ? 'verified  ' : 'UNVERIFIED'}  ${providersOf(u)}`
  counts.set(key, (counts.get(key) || 0) + 1)
}
console.log(`${users.length} auth accounts`)
for (const [k, n] of [...counts].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`)

// Unverified accounts in detail.
const unverified = users.filter((u) => !u.emailVerified)
if (unverified.length === 0) {
  console.log('\nNo unverified accounts.')
  process.exit(0)
}

const live = new Map() // email -> roles
for (const d of (await db.collection('project_members').get()).docs) {
  const m = d.data()
  if (m.removed_at || !m.email) continue
  const e = m.email.toLowerCase()
  live.set(e, [...(live.get(e) || []), m.role])
}

console.log(`\n${unverified.length} unverified (email, providers, created, last sign-in, live roles, approved):`)
for (const u of unverified.sort((a, b) => (a.email || '').localeCompare(b.email || ''))) {
  const email = (u.email || '(no email)').toLowerCase()
  const approved = u.email ? (await db.collection('approved_emails').doc(email).get()).exists : false
  const roles = live.get(email) || []
  console.log(
    [
      email,
      providersOf(u),
      u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString().slice(0, 10) : '-',
      u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString().slice(0, 10) : 'never',
      roles.length ? roles.join(',') : 'no-members',
      approved ? 'approved' : '-',
    ].join('  |  ')
  )
}
