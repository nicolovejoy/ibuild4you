#!/usr/bin/env node
// Read-only: for each email given, print what identifies it across Firebase
// Auth and Firestore — the auth account(s) and sign-in providers, the users
// doc(s) and their system_roles, live/removed project memberships by role, and
// the approved_emails row. Written for the admin-account consolidation
// (2026-10-28: gmail → alias of me.com, scu.edu retired) so every write step
// starts from what is actually there.
//
// Usage (prod, read-only):
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/inspect-admin-identities.mjs nlovejoy@me.com nicholas.lovejoy@gmail.com mlovejoy@scu.edu

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean)
if (emails.length === 0) {
  console.error('Usage: inspect-admin-identities.mjs <email> [<email> ...]')
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const slugs = new Map()
for (const d of (await db.collection('projects').get()).docs) {
  slugs.set(d.id, d.data().slug || d.id)
}

for (const email of emails) {
  console.log(`\n=== ${email}`)

  // Auth account. The read-only key may lack Auth permission; say so and go on.
  try {
    const u = await getAuth().getUserByEmail(email)
    const providers = u.providerData.map((p) => `${p.providerId}(${p.email || '-'})`).join(', ')
    console.log(`auth: uid ${u.uid} · providers ${providers || 'none'} · last sign-in ${u.metadata.lastSignInTime || '-'}`)
  } catch (err) {
    console.log(`auth: ${err.code || err.message}`)
  }

  const users = await db.collection('users').where('email', '==', email).get()
  if (users.empty) console.log('users doc: none')
  for (const d of users.docs) {
    const u = d.data()
    const roles = Array.isArray(u.system_roles) ? JSON.stringify(u.system_roles) : '(field absent → ADMIN_EMAILS fallback)'
    console.log(`users doc ${d.id}: system_roles ${roles} · name ${u.first_name || '-'} ${u.last_name || ''}`)
  }

  const members = await db.collection('project_members').where('email', '==', email).get()
  const live = members.docs.filter((d) => !d.data().removed_at)
  const removed = members.size - live.length
  const byRole = {}
  for (const d of live) byRole[d.data().role] = (byRole[d.data().role] || 0) + 1
  console.log(`memberships: ${live.length} live ${JSON.stringify(byRole)} · ${removed} removed`)
  for (const d of live) {
    console.log(`  ${d.data().role.padEnd(10)} ${slugs.get(d.data().project_id) || d.data().project_id} (member ${d.id})`)
  }

  const approved = await db.collection('approved_emails').doc(email).get()
  console.log(
    `approved_emails: ${approved.exists ? (approved.data().revoked_at ? `revoked ${approved.data().revoked_at}` : 'active') : 'none'}`
  )
}
