#!/usr/bin/env node
// Garm PR C: set the test admin's Firebase Auth password via Admin SDK and
// write it to a gitignored file, so scripts/lib/preview-login.mjs can sign in
// with email+password instead of the passcode being retired in PR D.
//
// Sibling to scripts/seed-test-admin.mjs (which still seeds the passcode-based
// project_members row — left alone; PR D is the one that scrubs passcodes).
// The two scripts are independent: run seed-test-admin.mjs once to create the
// user, then this one (repeatedly, to rotate) to give it a password.
//
// Run via the env wrapper matching the target (provides FIREBASE_SERVICE_ACCOUNT):
//   node scripts/with-preview-env.mjs node scripts/seed-test-admin-password.mjs --apply
//   node scripts/with-prod-env.mjs node scripts/seed-test-admin-password.mjs --apply --out .test-admin-password-prod
//
// Deterministic seeding: set SEED_PASSWORD to reuse a fixed value (e.g. from
// 1Password) instead of generating a fresh random one each run.
//
// The password is written directly to the output file (default
// .test-admin-password, gitignored) — never printed to stdout.

import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { initAdminDb } from './fixtures/db.mjs'

const APPLY = process.argv.includes('--apply')
const outIdx = process.argv.indexOf('--out')
const OUT_FILE = outIdx >= 0 ? process.argv[outIdx + 1] : '.test-admin-password'

const ADMIN_EMAIL = 'test@ibuild4you.com'

// Deliberately ungated init (targets prod or preview based on which env
// wrapper ran this script) — mirrors seed-test-admin.mjs.
const { adminAuth } = initAdminDb()

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (re-run with --apply to write)'}`)
console.log(`Admin email: ${ADMIN_EMAIL}`)
console.log(`Output file: ${OUT_FILE}`)
console.log()

const u = await adminAuth.getUserByEmail(ADMIN_EMAIL).catch((err) => {
  if (err?.code === 'auth/user-not-found') {
    console.error(`No Firebase Auth user for ${ADMIN_EMAIL} — run seed-test-admin.mjs --apply first.`)
    process.exit(1)
  }
  throw err
})

const password = (process.env.SEED_PASSWORD?.trim() || 'Pw-' + randomBytes(12).toString('base64url'))

if (!APPLY) {
  console.log('Dry-run complete. Re-run with --apply to actually set the password and write the file.')
  process.exit(0)
}

await adminAuth.updateUser(u.uid, { password })
writeFileSync(OUT_FILE, password + '\n')
console.log(`Password set on uid=${u.uid} and written to ${OUT_FILE} (gitignored, not printed).`)
process.exit(0)
