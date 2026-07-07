#!/usr/bin/env node
// Export a project's living brief + full conversation transcripts to markdown,
// for consumption by agents outside this app (e.g. Claude Cowork reading the
// byside brief). Output goes to the gitignored exports/ directory — transcripts
// contain PII and must never be committed.
//
// Always run through the read-only wrapper:
//   node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs <slug>
//   node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs byside --out exports
//
// Writes:
//   exports/<slug>/brief.md        — project meta + latest brief + reviewer annotations
//   exports/<slug>/session-NN.md   — one transcript per conversation (oldest first)
//
// All Firestore queries are single-field where-clauses with in-memory sorting,
// so no composite indexes are required.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const outIdx = process.argv.indexOf('--out')
const OUT_ROOT = outIdx >= 0 ? process.argv[outIdx + 1] : 'exports'
const TARGET = args[0]

if (!TARGET) {
  console.error(
    'Usage: node scripts/with-prod-env-ro.mjs node scripts/export-brief.mjs <slug-or-project-id> [--out exports]'
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

// --- resolve project by slug first, then by doc id ---
let projectDoc = null
const bySlug = await db.collection('projects').where('slug', '==', TARGET).limit(1).get()
if (!bySlug.empty) {
  projectDoc = bySlug.docs[0]
} else {
  const byId = await db.collection('projects').doc(TARGET).get()
  if (byId.exists) projectDoc = byId
}
if (!projectDoc) {
  console.error(
    `No project found with slug or id "${TARGET}". Try: node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs --grep ${TARGET}`
  )
  process.exit(1)
}
const project = { id: projectDoc.id, ...projectDoc.data() }
const slug = project.slug || project.id

// --- fetch everything (single-field queries, sort in memory) ---
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

// --- write output ---
const outDir = join(OUT_ROOT, slug)
if (existsSync(outDir)) rmSync(outDir, { recursive: true }) // stale files from removed sessions
mkdirSync(outDir, { recursive: true })

const day = (iso) => (iso || '').slice(0, 10)

// brief.md
const b = []
b.push(`# Brief: ${project.title}`)
b.push('')
b.push(
  `Exported from ibuild4you.com prod. Project slug: \`${slug}\`. Status: ${project.status || 'active'}.`
)
b.push(
  `Conversations: ${sessions.length}. Brief version: ${brief ? brief.version : 'none yet'} (updated ${brief ? day(brief.updated_at) : '—'}).`
)
if (project.context) b.push(`\n## Builder-provided context\n\n${project.context}`)
if (brief) {
  const c = brief.content || {}
  b.push(`\n## Problem\n\n${c.problem || '—'}`)
  b.push(`\n## Target users\n\n${c.target_users || '—'}`)
  b.push(`\n## Features\n`)
  for (const f of c.features || []) b.push(`- ${f}`)
  if (!(c.features || []).length) b.push('—')
  b.push(`\n## Constraints\n\n${c.constraints || '—'}`)
  if (c.additional_context) b.push(`\n## Additional context\n\n${c.additional_context}`)
  if ((c.decisions || []).length) {
    b.push(`\n## Decisions\n`)
    for (const d of c.decisions)
      b.push(`- **${d.topic}**: ${d.decision}${d.locked ? ' _(locked)_' : ''}`)
  }
  if ((c.open_risks || []).length) {
    b.push(`\n## Open risks\n`)
    for (const r of c.open_risks) b.push(`- ${r}`)
  }
}
if (reviews.some((r) => (r.annotations || []).length)) {
  b.push(`\n## Reviewer annotations\n`)
  for (const r of reviews) {
    for (const a of r.annotations || []) {
      b.push(`- [${a.section}] ${a.comment} _(${day(a.created_at)})_`)
    }
  }
}
writeFileSync(join(outDir, 'brief.md'), b.join('\n') + '\n')
console.log(`wrote ${join(outDir, 'brief.md')}`)

// session-NN.md — one per conversation, oldest first
let n = 0
for (const session of sessions) {
  n++
  const msgSnap = await db.collection('messages').where('session_id', '==', session.id).get()
  const messages = msgSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  messages.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))

  const m = []
  m.push(`# ${project.title} — conversation ${n} of ${sessions.length}`)
  m.push('')
  m.push(
    `Started ${day(session.created_at)}. Status: ${session.status}. Messages: ${messages.length}.`
  )
  if (session.summary) m.push(`\nSummary: ${session.summary}`)
  m.push('')
  for (const msg of messages) {
    const who =
      msg.role === 'agent' ? 'Agent (Sam)' : msg.sender_display_name || msg.sender_email || 'Maker'
    m.push(`## ${who} — ${day(msg.created_at)}`)
    m.push('')
    m.push(msg.content || '')
    if ((msg.file_ids || []).length) {
      m.push('')
      m.push(`_Attached: ${msg.file_ids.map((id) => fileNames.get(id) || id).join(', ')}_`)
    }
    m.push('')
  }
  const name = `session-${String(n).padStart(2, '0')}.md`
  writeFileSync(join(outDir, name), m.join('\n'))
  console.log(`wrote ${join(outDir, name)} (${messages.length} messages)`)
}

console.log(`\nDone. Export at ${outDir}/`)
