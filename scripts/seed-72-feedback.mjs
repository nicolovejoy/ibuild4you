#!/usr/bin/env node
// #72 verification helper — seed a few Loop feedback rows for the cast project
// (slug test-cast-cafe) on preview, so the chat agent can ground a "walk me
// through the site" ask in real reports. Idempotent via a seed marker.
//
// Usage: node scripts/with-preview-env.mjs node scripts/seed-72-feedback.mjs --apply
//        node scripts/with-preview-env.mjs node scripts/seed-72-feedback.mjs --clean

import { initFixtureDb, iso } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')
const CLEAN = process.argv.includes('--clean')
const SLUG = 'test-cast-cafe'
const MARKER = 'seed-72'

const ROWS = [
  { type: 'bug', body: 'The online menu page is blank on my phone — no items show up.', page_url: 'https://test-cafe.example.com/menu', status: 'new', ageDays: 0 },
  { type: 'idea', body: 'Could we add a photo gallery of the pastries on the homepage?', page_url: 'https://test-cafe.example.com/', status: 'new', ageDays: 2 },
  { type: 'bug', body: 'The contact form submit button does nothing when I click it.', page_url: 'https://test-cafe.example.com/contact', status: 'done', ageDays: 5 },
]

const { db, firebaseProjectId } = initFixtureDb({ requireWrite: APPLY || CLEAN })
console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)

if (CLEAN) {
  const snap = await db.collection('feedback').where('seed_marker', '==', MARKER).get()
  if (APPLY || true) {
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
  console.log(`Cleaned ${snap.size} seeded feedback rows.`)
  process.exit(0)
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} — slug=${SLUG}`)
const existing = await db.collection('feedback').where('seed_marker', '==', MARKER).get()
if (!existing.empty) {
  console.log(`${existing.size} seeded rows already present — skipping (run --clean to reset).`)
  process.exit(0)
}
if (!APPLY) {
  console.log(`DRY-RUN: would add ${ROWS.length} feedback rows. Re-run with --apply.`)
  process.exit(0)
}

const DAY = 24 * 60 * 60 * 1000
for (const r of ROWS) {
  const created = iso(r.ageDays * DAY)
  await db.collection('feedback').add({
    project_id: SLUG,
    type: r.type,
    body: r.body,
    submitter_email: 'test-originator@ibuild4you.com',
    submitter_uid: null,
    page_url: r.page_url,
    user_agent: 'seed/1.0',
    viewport: '390x844',
    status: r.status,
    internal_notes: null,
    github_issue_url: null,
    seed_marker: MARKER,
    created_at: created,
    updated_at: created,
  })
}
console.log(`Added ${ROWS.length} feedback rows for ${SLUG}.`)
process.exit(0)
