#!/usr/bin/env node
// Seed the seven live Loop apps into the `apps` collection (#237, Phase A).
//
// Loop feedback moves off briefs (`projects`) onto first-class apps. Each app
// doc is keyed by its slug and mirrors the `App` type in lib/types/index.ts
// (this script is plain ESM and cannot import the TS module, so the shape and
// the slug rules are mirrored by hand below).
//
// For each row in APPS the script:
//   - looks up the source brief (cruftBrief or legacy) by slug,
//   - copies github_repo and feedback_requires_identity onto the app,
//   - sets brief_id to the brief's doc id for legacy rows, null for cruft,
//   - sets legacy_slugs: [legacy] when the row has one,
//   - copies loop_signing_secrets/{briefDocId} to loop_signing_secrets/{slug}
//     when the source exists and the target does not (source is never deleted;
//     secret values are never printed).
// Feedback rows stored under a legacy slug are NOT rewritten: ingest stores the
// canonical slug from now on and the inbox resolves legacy ids via findAppBySlug.
// A missing source brief is reported on its row, not fatal: the app is still
// planned/written so the widget keeps working.
//
// Dry run by default (reads only, works under the read-only prod wrapper).
// Writes only with --apply. Idempotent: an app that already exists is skipped.
// The script never deletes a brief; it ends by listing the cruft briefs for
// Nico to delete by hand.
//
// Usage:
//   op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/migrate-loop-apps.mjs
//   op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/migrate-loop-apps.mjs --apply
//
// Production (Nico runs these after the PR merges):
//   dry run: op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/migrate-loop-apps.mjs
//   apply:   FIREBASE_SERVICE_ACCOUNT="$(op document get ibuild4you-firestore-admin --vault dev-secrets)" node scripts/migrate-loop-apps.mjs --apply

import { initAdminDb, findProjectBySlug } from './fixtures/db.mjs'

const APPS = [
  { slug: 'musicforge',   name: 'MusicForge',   cruftBrief: 'musicforge' },
  { slug: 'tideline',     name: 'Tideline',     cruftBrief: 'tideline' },
  { slug: 'photomirande', name: 'photomirande', cruftBrief: 'photomirande' },
  { slug: 'byside',       name: 'BySide',       legacy: 'byside-validate-the-buyers-offer-to-close-journey' },
  { slug: 'prntd',        name: 'PRNTD',        legacy: 'prntd-mobile-flow-rethink' },
  { slug: 'bakerylouise', name: 'Bakery Louise', legacy: 'bakery-louise' },
  { slug: 'l6-music',     name: 'L6 Music',     legacy: 'l6-shapes-positions-game' },
]

const CREATED_BY = 'migration:2026-10-29'
const APPLY = process.argv.includes('--apply')

// Mirrors isValidAppSlug in lib/api/apps.ts.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const validSlug = (s) => s.length <= 64 && SLUG_RE.test(s)

const { db, firebaseProjectId } = initAdminDb()
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} against Firebase project: ${firebaseProjectId}\n`)

// Who already claims each id (canonical or legacy), from the live apps collection.
// Map id -> owning app slug.
const claims = new Map()
const appsSnap = await db.collection('apps').get()
for (const d of appsSnap.docs) {
  claims.set(d.id, d.id)
  for (const l of d.data().legacy_slugs ?? []) claims.set(l, d.id)
}

let planned = 0
let wrote = 0
let skipped = 0
let refused = 0
const cruftReport = []

for (const row of APPS) {
  const sourceSlug = row.cruftBrief ?? row.legacy
  const brief = await findProjectBySlug(db, sourceSlug)
  const briefData = brief ? brief.data() : null
  const tag = `[${row.slug}]`

  if (row.cruftBrief) cruftReport.push({ slug: row.cruftBrief, id: brief ? brief.id : null })

  console.log(`${tag} ${row.name}`)
  console.log(`  source brief "${sourceSlug}": ${brief ? `found (${brief.id})` : 'NOT FOUND (app will still be created, no copied settings)'}`)

  // Slug validity (defensive; the map is fixed).
  const badSlug = [row.slug, row.legacy].filter(Boolean).find((id) => !validSlug(id))
  if (badSlug) {
    console.log(`  REFUSED: invalid slug "${badSlug}"\n`)
    refused++
    continue
  }

  // Existing app under the same slug -> idempotent skip.
  if (claims.get(row.slug) === row.slug) {
    console.log('  exists, skipped')
    skipped++
    console.log('')
    continue
  }

  // Uniqueness: slug or legacy slug held by a DIFFERENT app.
  const conflicts = [row.slug, row.legacy].filter(Boolean).filter((id) => claims.has(id) && claims.get(id) !== row.slug)
  if (conflicts.length) {
    console.log(`  REFUSED: ${conflicts.map((c) => `"${c}" already claimed by app "${claims.get(c)}"`).join('; ')}`)
    refused++
    console.log('')
    continue
  }

  // Build the doc. No undefined values (Firestore rejects them).
  const now = new Date().toISOString()
  const doc = {
    slug: row.slug,
    name: row.name,
    brief_id: row.legacy && brief ? brief.id : null,
    created_by: CREATED_BY,
    created_at: now,
    updated_at: now,
  }
  if (briefData?.github_repo) doc.github_repo = briefData.github_repo
  if (typeof briefData?.feedback_requires_identity === 'boolean') {
    doc.feedback_requires_identity = briefData.feedback_requires_identity
  }
  if (row.legacy) doc.legacy_slugs = [row.legacy]

  // Signing secret: copy only if the source exists and the target does not.
  let secretAction = 'no secret'
  let secretData = null
  if (brief) {
    const [src, dst] = await Promise.all([
      db.collection('loop_signing_secrets').doc(brief.id).get(),
      db.collection('loop_signing_secrets').doc(row.slug).get(),
    ])
    if (dst.exists) secretAction = 'secret already present'
    else if (src.exists) {
      secretAction = 'secret copied'
      secretData = src.data()
    }
  }

  const { created_at, updated_at, ...shown } = doc
  console.log(`  ${APPLY ? 'writing' : 'would write'} apps/${row.slug}: ${JSON.stringify(shown)}`)
  console.log(`  signing secret: ${APPLY ? secretAction : secretAction.replace('copied', 'would be copied')}`)
  planned++

  if (APPLY) {
    await db.collection('apps').doc(row.slug).set(doc)
    if (secretData) await db.collection('loop_signing_secrets').doc(row.slug).set(secretData)
    claims.set(row.slug, row.slug)
    if (row.legacy) claims.set(row.legacy, row.slug)
    wrote++
  }
  console.log('')
}

console.log(
  APPLY
    ? `Done: ${wrote} written, ${skipped} exists/skipped, ${refused} refused.`
    : `Dry run: ${planned} planned write(s), ${skipped} exists/skipped, ${refused} refused. Nothing written.`,
)

console.log('\nDelete by hand (Nico):')
for (const c of cruftReport) {
  console.log(`  ${c.slug}: ${c.id ?? 'not found'}`)
}

if (!APPLY) {
  console.log('\nProduction commands:')
  console.log('  dry run: op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/migrate-loop-apps.mjs')
  console.log('  apply:   FIREBASE_SERVICE_ACCOUNT="$(op document get ibuild4you-firestore-admin --vault dev-secrets)" node scripts/migrate-loop-apps.mjs --apply')
}

if (refused) process.exit(1)
