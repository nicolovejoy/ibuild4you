#!/usr/bin/env node
// Export project briefs + full conversation transcripts to markdown, for
// consumption by agents outside this app (e.g. Claude Cowork reading the
// byside briefs). Output goes to the gitignored exports/ directory —
// transcripts contain PII and must never be committed.
//
// Always run through the read-only wrapper:
//   node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs <slug> [<slug> ...]
//   node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs --repo nicolovejoy/byside --out ~/src/byside/ibuild-export
//   node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs --grep byside
//
// --repo exports every project whose github_repo maps to that repository —
// the canonical brief→repo mapping (set per brief in the builder Setup tab).
// Stored values are normalized, so "byside", "nicolovejoy/byside" and
// "https://github.com/nicolovejoy/byside" all match --repo nicolovejoy/byside.
// Use --repo (not --grep) when exporting into a host repo, so a repo only
// ever receives its own briefs — no cross-contamination.
//
// --grep exports every project whose slug or title contains the substring
// (case-insensitive) — same matching as list-projects.mjs. Ad-hoc use only.
//
// Writes, per project:
//   exports/<slug>/brief.md        — project meta + latest brief + reviewer annotations
//   exports/<slug>/session-NN.md   — one transcript per conversation (oldest first)
//
// All Firestore queries are single-field where-clauses with in-memory sorting,
// so no composite indexes are required.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoMatches, renderBriefMd, renderSessionMd } from './lib/brief-markdown.mjs'

const argv = process.argv.slice(2)
const flagValue = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const OUT_ROOT = flagValue('--out') || 'exports'
const GREP = flagValue('--grep')?.toLowerCase() || null
const REPO = flagValue('--repo') || null
// Positional slugs/ids: everything that isn't a flag or a flag's value
const flagValues = new Set(
  [flagValue('--out'), flagValue('--grep'), flagValue('--repo')].filter(Boolean)
)
const targets = argv.filter((a) => !a.startsWith('--') && !flagValues.has(a))

if (!targets.length && !GREP && !REPO) {
  console.error(
    'Usage: node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs <slug-or-id> [<slug-or-id> ...] [--repo owner/name] [--grep substring] [--out exports]'
  )
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (run via with-prod-env-ro.mjs)')
  process.exit(1)
}
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

// --- resolve targets to project docs (dedup by doc id) ---
const projects = new Map() // id -> data

for (const target of targets) {
  const bySlug = await db.collection('projects').where('slug', '==', target).limit(1).get()
  if (!bySlug.empty) {
    projects.set(bySlug.docs[0].id, bySlug.docs[0].data())
    continue
  }
  const byId = await db.collection('projects').doc(target).get()
  if (byId.exists) {
    projects.set(byId.id, byId.data())
    continue
  }
  console.error(
    `No project found with slug or id "${target}". Try: node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs --grep ${target}`
  )
  process.exit(1)
}

if (GREP || REPO) {
  const snap = await db.collection('projects').get()
  for (const d of snap.docs) {
    const { slug = '', title = '', github_repo } = d.data()
    if (GREP && (slug.toLowerCase().includes(GREP) || title.toLowerCase().includes(GREP))) {
      projects.set(d.id, d.data())
    }
    if (REPO && github_repo && repoMatches(github_repo, REPO)) {
      projects.set(d.id, d.data())
    }
  }
  if (!projects.size) {
    console.error(`No projects match ${REPO ? `--repo "${REPO}"` : `--grep "${GREP}"`}.`)
    process.exit(1)
  }
}

async function exportProject(id, data) {
  const project = { id, ...data }
  const slug = project.slug || project.id

  // Fetch everything (single-field queries, sort in memory)
  const [briefSnap, sessionSnap, reviewSnap, fileSnap] = await Promise.all([
    db.collection('briefs').where('project_id', '==', project.id).get(),
    db.collection('sessions').where('project_id', '==', project.id).get(),
    db.collection('reviews').where('project_id', '==', project.id).get(),
    db.collection('files').where('project_id', '==', project.id).get(),
  ])

  const briefs = briefSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  briefs.sort((a, b) => (b.version || 0) - (a.version || 0))
  const brief = briefs[0] || null

  // Skip archived sessions — same as the app's own listing (lib/sessions/active.ts)
  const sessions = sessionSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => s.status !== 'archived')
  sessions.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))

  const reviews = reviewSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const fileNames = new Map(fileSnap.docs.map((d) => [d.id, d.data().filename || d.id]))

  const outDir = join(OUT_ROOT, slug)
  if (existsSync(outDir)) rmSync(outDir, { recursive: true }) // stale files from removed sessions
  mkdirSync(outDir, { recursive: true })

  // brief.md
  writeFileSync(join(outDir, 'brief.md'), renderBriefMd({ project, brief, sessions, reviews }))
  console.log(`wrote ${join(outDir, 'brief.md')}`)

  // session-NN.md — one per conversation, oldest first
  let n = 0
  for (const session of sessions) {
    n++
    const msgSnap = await db.collection('messages').where('session_id', '==', session.id).get()
    const messages = msgSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    messages.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))

    const md = renderSessionMd({ project, session, n, total: sessions.length, messages, fileNames })
    const name = `session-${String(n).padStart(2, '0')}.md`
    writeFileSync(join(outDir, name), md)
    console.log(`wrote ${join(outDir, name)} (${messages.length} messages)`)
  }
}

for (const [id, data] of projects) {
  await exportProject(id, data)
}
console.log(`\nDone. ${projects.size} project(s) exported to ${OUT_ROOT}/`)
