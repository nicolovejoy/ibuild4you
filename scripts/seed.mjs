#!/usr/bin/env node
// One entrypoint for all preview test-data scenarios (#61).
//
// Always run via the preview env wrapper so FIREBASE_SERVICE_ACCOUNT points at
// the sandbox (the runner refuses to write to a non-preview project):
//
//   node scripts/with-preview-env.mjs node scripts/seed.mjs list
//   node scripts/with-preview-env.mjs node scripts/seed.mjs <scenario>            # dry-run
//   node scripts/with-preview-env.mjs node scripts/seed.mjs <scenario> --apply    # write
//   node scripts/with-preview-env.mjs node scripts/seed.mjs <scenario> --clean    # remove (scenario-scoped)
//   node scripts/with-preview-env.mjs node scripts/seed.mjs reset --apply         # wipe ALL fixtures + re-seed the standard set
//
// Scenarios live in scripts/fixtures/scenarios/ and are listed in registry.mjs.

import { initFixtureDb, cleanAll } from './fixtures/db.mjs'
import { SCENARIOS, findScenario } from './fixtures/registry.mjs'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [cmd] = args.filter((a) => !a.startsWith('--'))
const APPLY = flags.has('--apply')
const CLEAN = flags.has('--clean')
const log = (m) => console.log(m)

function usage(code = 1) {
  console.log('Usage: scripts/seed.mjs <list|reset|SCENARIO> [--apply|--clean]')
  console.log('  list             show scenarios')
  console.log('  reset --apply    wipe ALL fixtures, then seed every standard scenario')
  console.log('  SCENARIO         dry-run a scenario (add --apply to write, --clean to remove)')
  process.exit(code)
}

if (!cmd || cmd === 'help' || cmd === '--help') usage(0)

if (cmd === 'list') {
  for (const s of SCENARIOS) {
    console.log(`${s.name.padEnd(20)} ${s.standard ? '[standard] ' : '           '}${s.description}`)
  }
  process.exit(0)
}

const needsWrite = APPLY || CLEAN || cmd === 'reset'
const { db, adminAuth, firebaseProjectId } = initFixtureDb({ requireWrite: needsWrite })
console.log(`Firebase project: ${firebaseProjectId || '(unknown)'}`)

if (cmd === 'reset') {
  if (!APPLY) {
    console.error('reset is destructive (wipes ALL fixtures). Re-run with --apply.')
    process.exit(1)
  }
  const counts = await cleanAll(db)
  console.log(`Wiped all fixtures: ${JSON.stringify(counts)}`)
  for (const s of SCENARIOS.filter((s) => s.standard)) {
    console.log(`\n# ${s.name}`)
    await s.seed({ db, adminAuth, apply: true, log })
  }
  process.exit(0)
}

const scenario = findScenario(cmd)
if (!scenario) {
  console.error(`Unknown scenario "${cmd}". Run: scripts/seed.mjs list`)
  process.exit(1)
}

if (CLEAN) {
  const counts = await cleanAll(db, { scenario: scenario.name })
  console.log(`Cleaned ${scenario.name}: ${JSON.stringify(counts)}`)
  process.exit(0)
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log()
await scenario.seed({ db, adminAuth, apply: APPLY, log })
process.exit(0)
