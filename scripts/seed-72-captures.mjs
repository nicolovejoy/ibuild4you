#!/usr/bin/env node
// #72 slice B2 verification helper — seed structural page captures
// (prototype_context rows) for the cast project on preview, so the chat agent
// can ground a "walk me through the site" ask in real page structure.
// Idempotent via a seed marker.
//
// Usage: node scripts/with-preview-env.mjs node scripts/seed-72-captures.mjs --apply
//        node scripts/with-preview-env.mjs node scripts/seed-72-captures.mjs --clean

import { initFixtureDb, iso } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')
const CLEAN = process.argv.includes('--clean')
const SLUG = 'test-cast-cafe'
const MARKER = 'seed-72b'

const ROWS = [
  {
    route: '/menu',
    title: 'Menu — Test Cast Cafe',
    outline:
      'h1: Our Menu\nh2: Drinks\nh2: Pastries\nnav (Main): Home | Menu | Order | Contact\nbuttons: Order now | Add to cart\nfields: Search the menu\nlist: 6 items',
    ageDays: 0,
  },
  {
    route: '/order',
    title: 'Order pickup — Test Cast Cafe',
    outline:
      'h1: Order for pickup\nh2: Your items\nh2: Pickup time\nnav (Main): Home | Menu | Order | Contact\nbuttons: Choose time | Place order\nfields: Name | Phone number\ntable: 3 rows',
    ageDays: 1,
  },
]

const { db, firebaseProjectId } = initFixtureDb({ requireWrite: APPLY || CLEAN })
console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)

if (CLEAN) {
  const snap = await db.collection('prototype_context').where('seed_marker', '==', MARKER).get()
  const batch = db.batch()
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
  console.log(`Cleaned ${snap.size} seeded capture rows.`)
  process.exit(0)
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} — slug=${SLUG}`)
const existing = await db.collection('prototype_context').where('seed_marker', '==', MARKER).get()
if (!existing.empty) {
  console.log(`${existing.size} seeded rows already present — skipping (run --clean to reset).`)
  process.exit(0)
}
if (!APPLY) {
  console.log(`DRY-RUN: would add ${ROWS.length} capture rows. Re-run with --apply.`)
  process.exit(0)
}

const DAY = 24 * 60 * 60 * 1000
for (const r of ROWS) {
  const created = iso(r.ageDays * DAY)
  await db.collection('prototype_context').add({
    project_id: SLUG,
    feedback_id: null,
    source: 'loop-widget',
    capture_version: 1,
    route: r.route,
    title: r.title,
    outline: r.outline,
    viewport: '1200x900',
    user_agent: 'seed/1.0',
    submitter_uid: null,
    status: 'active',
    seed_marker: MARKER,
    created_at: created,
    updated_at: created,
  })
}
console.log(`Added ${ROWS.length} capture rows for ${SLUG}.`)
process.exit(0)
