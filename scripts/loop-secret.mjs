#!/usr/bin/env node
// Mint / rotate the per-project Loop identity-relay signing secret (#149).
//
// loop_signing_secrets/{projectDocId} holds { keys: { k1: "...", ... },
// active_kid: "k1" } — never returned by any GET/API response. This script
// is the ONLY way to see a secret's value (deliberately no admin-UI reveal
// button, per the #149 design). The host app's server copies the printed
// secret into its own secret manager to sign identityAssertion tokens.
//
// Usage:
//   node scripts/with-prod-env.mjs node scripts/loop-secret.mjs <slug>
//     Mints an initial secret (kid "k1"). Refuses if one already exists —
//     use --rotate to add a new key instead of silently replacing.
//
//   node scripts/with-prod-env.mjs node scripts/loop-secret.mjs <slug> --rotate
//     Adds a new key (kid incremented, e.g. k1 -> k2), sets it active, KEEPS
//     old keys so tokens signed with the old secret still verify during
//     rollover.
//
//   node scripts/with-prod-env.mjs node scripts/loop-secret.mjs <slug> --rotate --prune
//     Same as --rotate, then drops every key except the new active one —
//     use once you're sure nothing is still signing with the old secret.
//
// Preview: swap with-prod-env.mjs for with-preview-env.mjs.

import { randomBytes } from 'node:crypto'
import { initAdminDb } from './fixtures/db.mjs'

const args = process.argv.slice(2)
const slug = args.find((a) => !a.startsWith('--'))
const ROTATE = args.includes('--rotate')
const PRUNE = args.includes('--prune')

if (!slug) {
  console.error('Usage: node scripts/loop-secret.mjs <projectSlug> [--rotate] [--prune]')
  process.exit(1)
}
if (PRUNE && !ROTATE) {
  console.error('--prune only makes sense with --rotate')
  process.exit(1)
}

const { db } = initAdminDb()

function nextKid(keys) {
  // kids are "k<N>" — find the highest N present and increment.
  let maxN = 0
  for (const kid of Object.keys(keys)) {
    const m = /^k(\d+)$/.exec(kid)
    if (m) maxN = Math.max(maxN, Number(m[1]))
  }
  return `k${maxN + 1}`
}

const projectSnap = await db.collection('projects').where('slug', '==', slug).limit(1).get()
if (projectSnap.empty) {
  console.error(`No project with slug "${slug}"`)
  process.exit(1)
}
const projectId = projectSnap.docs[0].id

const secretRef = db.collection('loop_signing_secrets').doc(projectId)
const existing = await secretRef.get()
const now = new Date().toISOString()

if (!existing.exists) {
  if (ROTATE) {
    console.error(`No existing secret for "${slug}" — nothing to rotate. Run without --rotate to mint the first one.`)
    process.exit(1)
  }
  const secret = randomBytes(32).toString('base64url')
  await secretRef.set({
    keys: { k1: secret },
    active_kid: 'k1',
    created_at: now,
    updated_at: now,
  })
  console.log(`Minted secret for "${slug}" (project ${projectId})`)
  console.log(`  kid: k1`)
  console.log(`  secret: ${secret}`)
  process.exit(0)
}

const data = existing.data()
const keys = { ...(data.keys ?? {}) }

if (!ROTATE) {
  console.error(`A secret already exists for "${slug}" (active kid: ${data.active_kid}). Use --rotate to add a new key.`)
  process.exit(1)
}

const newKid = nextKid(keys)
const secret = randomBytes(32).toString('base64url')
keys[newKid] = secret
const finalKeys = PRUNE ? { [newKid]: secret } : keys

await secretRef.set(
  { keys: finalKeys, active_kid: newKid, updated_at: now },
  { merge: false }
)

console.log(`Rotated secret for "${slug}" (project ${projectId})`)
console.log(`  new active kid: ${newKid}`)
console.log(`  secret: ${secret}`)
if (PRUNE) {
  console.log(`  pruned old keys — only ${newKid} remains`)
} else {
  console.log(`  old keys kept for rollover: ${Object.keys(data.keys ?? {}).join(', ')}`)
}
