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
let failed = 0
const cruftReport = []

// Signing secret: copy only if the source exists and the target does not.
// Returns the status text plus the data to write (null when nothing to copy).
// Secret values are never printed.
async function secretStatus(brief, slug) {
  if (!brief) return { action: 'no secret', data: null }
  const [src, dst] = await Promise.all([
    db.collection('loop_signing_secrets').doc(brief.id).get(),
    db.collection('loop_signing_secrets').doc(slug).get(),
  ])
  if (dst.exists) return { action: 'secret already present', data: null }
  if (src.exists) return { action: 'secret copied', data: src.data() }
  return { action: 'no secret', data: null }
}

// Print the status, and write the secret when applying. Dry run says "would be copied".
async function handleSecret(brief, slug) {
  const { action, data } = await secretStatus(brief, slug)
  console.log(`  signing secret: ${APPLY ? action : action.replace('copied', 'would be copied')}`)
  if (APPLY && data) await db.collection('loop_signing_secrets').doc(slug).set(data)
}

async function processRow(row) {
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
    console.log(`  REFUSED: invalid slug "${badSlug}"`)
    refused++
    return
  }

  // Existing app under the same slug -> idempotent skip, but still heal a
  // missing signing secret (an earlier run may have died between the writes).
  if (claims.get(row.slug) === row.slug) {
    console.log('  exists, skipped')
    await handleSecret(brief, row.slug)
    skipped++
    return
  }

  // Uniqueness: slug or legacy slug held by a DIFFERENT app.
  const conflicts = [row.slug, row.legacy].filter(Boolean).filter((id) => claims.has(id) && claims.get(id) !== row.slug)
  if (conflicts.length) {
    console.log(`  REFUSED: ${conflicts.map((c) => `"${c}" already claimed by app "${claims.get(c)}"`).join('; ')}`)
    refused++
    return
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

  console.log(`  ${APPLY ? 'writing' : 'would write'} apps/${row.slug}: ${JSON.stringify(doc)}`)
  planned++

  // Secret first, then the app: the app doc is the idempotency marker, so a
  // failure between the two writes leaves no app and the re-run retries both.
  await handleSecret(brief, row.slug)
  if (APPLY) {
    await db.collection('apps').doc(row.slug).set(doc)
    claims.set(row.slug, row.slug)
    if (row.legacy) claims.set(row.legacy, row.slug)
    wrote++
  }
}

for (const row of APPS) {
  try {
    await processRow(row)
  } catch (err) {
    failed++
    console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log('')
}

console.log(
  APPLY
    ? `Done: ${wrote} written, ${skipped} exists/skipped, ${refused} refused, ${failed} failed.`
    : `Dry run: ${planned} planned write(s), ${skipped} exists/skipped, ${refused} refused, ${failed} failed. Nothing written.`,
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

if (refused || failed) process.exit(1)
