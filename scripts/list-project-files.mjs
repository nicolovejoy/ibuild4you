#!/usr/bin/env node
// List all files for a project — useful for telling a maker what we have
// when their upload UI gets confusing or things go wrong.
//
// Usage:
//   export FIREBASE_SERVICE_ACCOUNT=$(grep FIREBASE_SERVICE_ACCOUNT .env.local | cut -d= -f2-)
//   node scripts/list-project-files.mjs <project-slug-or-id>
//
// Output: human-readable table on stdout, also pipes a clean Markdown list to
// the clipboard via pbcopy so you can paste it into a reply to the maker.

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { spawn } from 'node:child_process'

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/list-project-files.mjs <project-slug-or-id>')
  process.exit(1)
}

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
if (!serviceAccount) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT env var first.')
  process.exit(1)
}

initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
const db = getFirestore()

// Resolve slug → project_id (or accept a raw id)
let projectId = arg
let projectTitle = '(unknown)'
const bySlug = await db.collection('projects').where('slug', '==', arg).limit(1).get()
if (!bySlug.empty) {
  projectId = bySlug.docs[0].id
  projectTitle = bySlug.docs[0].data().title || projectTitle
} else {
  const byId = await db.collection('projects').doc(arg).get()
  if (byId.exists) {
    projectTitle = byId.data().title || projectTitle
  } else {
    console.error(`No project found with slug or id "${arg}"`)
    process.exit(1)
  }
}

const snap = await db
  .collection('files')
  .where('project_id', '==', projectId)
  .orderBy('created_at', 'asc')
  .get()

console.log(`\nProject: ${projectTitle} (${projectId})`)
console.log(`Files: ${snap.size}\n`)

const fmtSize = (n) => (n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)}KB` : `${(n / (1024 * 1024)).toFixed(1)}MB`)

const rows = snap.docs.map((d) => {
  const f = d.data()
  return {
    filename: f.filename,
    size: fmtSize(f.size_bytes || 0),
    status: f.status || 'ready',
    uploaded_by: f.uploaded_by_name || f.uploaded_by_email,
    created_at: f.created_at,
  }
})

for (const r of rows) {
  console.log(`  ${r.filename}  ·  ${r.size}  ·  ${r.status}  ·  ${r.uploaded_by}  ·  ${r.created_at}`)
}

// Build a clean Markdown list and put it on the clipboard for pasting.
const md = rows.map((r) => `- ${r.filename} (${r.size})`).join('\n')

const pb = spawn('pbcopy')
pb.stdin.write(md)
pb.stdin.end()
pb.on('close', () => {
  console.log(`\nMarkdown list copied to clipboard (${rows.length} files).`)
  process.exit(0)
})
