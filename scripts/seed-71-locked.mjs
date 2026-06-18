#!/usr/bin/env node
// #71 verification helper — add a LOCKED decision to the existing multi-human
// cast brief (test-cast-cafe) on preview, so a maker turn can be made to
// contradict it and we can eyeball whether Sam flags-and-confirms vs silently
// appends. Idempotent: updates the latest brief doc's content in place.
//
// Usage: node scripts/with-preview-env.mjs node scripts/seed-71-locked.mjs --apply

import { initFixtureDb, findProjectBySlug, iso } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')
const SLUG = 'test-cast-cafe'

// A plausible do-not-use constraint a maker might naturally try to reverse.
const LOCKED_DECISION = {
  topic: 'Ordering',
  decision: 'In-person ordering only — no online ordering for launch',
  locked: true,
}

const { db, firebaseProjectId } = initFixtureDb({ requireWrite: APPLY })
console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)

const project = await findProjectBySlug(db, SLUG)
if (!project) {
  console.error(`No project with slug ${SLUG}. Seed the cast first: node scripts/with-preview-env.mjs node scripts/seed.mjs multi-human-cast --apply`)
  process.exit(1)
}
const pid = project.id

const briefsSnap = await db
  .collection('briefs')
  .where('project_id', '==', pid)
  .orderBy('version', 'desc')
  .limit(1)
  .get()

if (briefsSnap.empty) {
  console.error('No brief found for the cast project.')
  process.exit(1)
}

const briefDoc = briefsSnap.docs[0]
const content = briefDoc.data().content || {}
const decisions = Array.isArray(content.decisions) ? content.decisions : []
const already = decisions.some((d) => d.topic === LOCKED_DECISION.topic && d.locked)

console.log(`Brief v${briefDoc.data().version}; existing decisions: ${JSON.stringify(decisions)}`)
console.log(`Locked decision to ensure: ${JSON.stringify(LOCKED_DECISION)}`)

if (already) {
  console.log('Locked decision already present — nothing to do.')
  process.exit(0)
}
if (!APPLY) {
  console.log('DRY-RUN: would add the locked decision. Re-run with --apply.')
  process.exit(0)
}

const next = [LOCKED_DECISION, ...decisions.filter((d) => d.topic !== LOCKED_DECISION.topic)]
await briefDoc.ref.update({ content: { ...content, decisions: next }, updated_at: iso() })
console.log('Applied. Brief now carries the locked "Ordering" decision.')
process.exit(0)
