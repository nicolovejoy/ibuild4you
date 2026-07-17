#!/usr/bin/env node
// Back-compat shim. The multi-human cast is now a fixtures scenario (#61);
// prefer the unified runner:
//
//   node scripts/with-preview-env.mjs node scripts/seed.mjs multi-human-cast --apply
//   node scripts/with-preview-env.mjs node scripts/seed.mjs multi-human-cast --clean
//
// This wrapper preserves the original invocation (and the .test-cast-passwords
// .json side effect) so existing e2e scripts and muscle memory keep working. Logic lives in scripts/fixtures/scenarios/multi-human-cast.mjs.

import { initFixtureDb, cleanAll } from './fixtures/db.mjs'
import { scenario } from './fixtures/scenarios/multi-human-cast.mjs'

const APPLY = process.argv.includes('--apply')
const CLEAN = process.argv.includes('--clean')
const { db, adminAuth, firebaseProjectId } = initFixtureDb({ requireWrite: APPLY || CLEAN })

console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)
if (CLEAN) {
  console.log(`Cleaned ${scenario.name}: ${JSON.stringify(await cleanAll(db, { scenario: scenario.name }))}`)
  process.exit(0)
}
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log()
await scenario.seed({ db, adminAuth, apply: APPLY, log: (m) => console.log(m) })
process.exit(0)
