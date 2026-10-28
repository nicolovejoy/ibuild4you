#!/usr/bin/env node
// One-off (2026-10-28): fold nicholas.lovejoy@gmail.com into nlovejoy@me.com,
// the one admin account. Firestore side only — the Garm side (revoke gmail's
// grant, then alias gmail → me.com) is a separate step after this applies.
//
// For gmail's live project_members rows:
//   - me.com already a live member of that brief → DELETE gmail's row. It is a
//     duplicate of the same human; keeping both splits one person into two
//     roster participants (see CLAUDE.md on aliasing).
//   - otherwise → REKEY the row: email and user_id become me.com's.
// Then on gmail's identity:
//   - users doc: delete the system_roles field. Deleted, not emptied: with the
//     field absent, a gmail sign-in (aliased to me.com by Garm) falls back to
//     ADMIN_EMAILS for the canonical address and is still admin; an empty
//     array would win over that fallback and lock the alias out of admin.
//   - approved_emails row: revoke (revoked_at/revoked_by, as the app does), so
//     the Garm reconcile does not re-grant the aliased address.
//
// Dry run by default; --apply writes. Needs a write-capable key, so Nico runs:
//   FIREBASE_SERVICE_ACCOUNT="$(op document get ibuild4you-firestore-admin --vault dev-secrets)" node scripts/consolidate-admin-identity.mjs
//   FIREBASE_SERVICE_ACCOUNT="$(op document get ibuild4you-firestore-admin --vault dev-secrets)" node scripts/consolidate-admin-identity.mjs --apply

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const FROM = 'nicholas.lovejoy@gmail.com'
const TO = 'nlovejoy@me.com'
const APPLY = process.argv.includes('--apply')

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (re-run with --apply to write) ===')

// me.com's uid comes from its users doc — exactly one expected.
const toUsers = await db.collection('users').where('email', '==', TO).get()
if (toUsers.size !== 1) {
  console.error(`expected one users doc for ${TO}, found ${toUsers.size}; stopping`)
  process.exit(1)
}
const toUid = toUsers.docs[0].id

const slugs = new Map()
for (const d of (await db.collection('projects').get()).docs) slugs.set(d.id, d.data().slug || d.id)

const live = (snap) => snap.docs.filter((d) => !d.data().removed_at)
const fromRows = live(await db.collection('project_members').where('email', '==', FROM).get())
const toProjects = new Set(
  live(await db.collection('project_members').where('email', '==', TO).get()).map((d) => d.data().project_id)
)

const now = new Date().toISOString()
let deleted = 0
let rekeyed = 0
for (const d of fromRows) {
  const { project_id, role } = d.data()
  const slug = slugs.get(project_id) || project_id
  if (toProjects.has(project_id)) {
    console.log(`delete duplicate  ${role.padEnd(8)} ${slug}`)
    if (APPLY) await d.ref.delete()
    deleted++
  } else {
    console.log(`rekey to ${TO}  ${role.padEnd(8)} ${slug}`)
    if (APPLY) await d.ref.update({ email: TO, user_id: toUid, updated_at: now })
    rekeyed++
  }
}

const fromUsers = await db.collection('users').where('email', '==', FROM).get()
for (const d of fromUsers.docs) {
  const roles = d.data().system_roles
  console.log(`users doc ${d.id}: system_roles ${JSON.stringify(roles)} → field deleted`)
  if (APPLY && roles !== undefined) await d.ref.update({ system_roles: FieldValue.delete() })
}

const approved = db.collection('approved_emails').doc(FROM)
const approvedDoc = await approved.get()
if (approvedDoc.exists && !approvedDoc.data().revoked_at) {
  console.log(`approved_emails ${FROM}: active → revoked`)
  if (APPLY) await approved.update({ revoked_at: now, revoked_by: TO })
} else {
  console.log(`approved_emails ${FROM}: ${approvedDoc.exists ? 'already revoked' : 'none'}, nothing to do`)
}

console.log(`\n${deleted} duplicate rows deleted, ${rekeyed} rows rekeyed${APPLY ? '' : ' (dry run)'}`)
