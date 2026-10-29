#!/usr/bin/env node
// List Loop apps (slug + name + legacy slugs + github_repo), optionally filtered
// by a substring match against slug, name or a legacy slug. Handy when a host
// app embedding the feedback widget needs the exact apps.slug to send as
// projectId. Read-only.
//
// Usage:
//   node scripts/with-prod-env-ro.mjs node scripts/list-apps.mjs
//   node scripts/with-prod-env-ro.mjs node scripts/list-apps.mjs --grep byside

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

const snap = await db.collection('apps').get()
let rows = snap.docs.map((d) => ({
  slug: d.data().slug || d.id,
  name: d.data().name || '(no name)',
  legacy: (d.data().legacy_slugs || []).join(', '),
  repo: d.data().github_repo || '',
}))
if (GREP) {
  rows = rows.filter((r) =>
    [r.slug, r.name, r.legacy].some((v) => v.toLowerCase().includes(GREP))
  )
}
rows.sort((a, b) => a.slug.localeCompare(b.slug))

console.log(`apps${GREP ? ` matching "${GREP}"` : ''}: ${rows.length}\n`)
console.log(`${'slug'.padEnd(24)}  ${'name'.padEnd(28)}  ${'github_repo'.padEnd(28)}  legacy_slugs`)
for (const r of rows) {
  console.log(
    `${r.slug.padEnd(24)}  ${r.name.slice(0, 28).padEnd(28)}  ${r.repo.padEnd(28)}  ${r.legacy}`
  )
}
