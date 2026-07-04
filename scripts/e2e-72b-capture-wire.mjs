#!/usr/bin/env node
// #72 slice B1 verification — the capture wire path end-to-end against a real
// deploy: POST /api/feedback with a structural capture, then read Firestore to
// assert the prototype_context row landed (and the feedback row got flagged).
// Cleans up its own rows at the end.
//
// Usage: node scripts/with-preview-env.mjs node scripts/e2e-72b-capture-wire.mjs
//        (E2E_BASE overrides the target, defaults to preview)

import { readFileSync } from 'node:fs'
import { initFixtureDb } from './fixtures/db.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const SLUG = 'test-cast-cafe'
const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()

const { db, firebaseProjectId } = initFixtureDb({ requireWrite: true })
console.log(`Target: ${BASE} — Firebase project: ${firebaseProjectId || '(unknown)'}`)

const capture = {
  v: 1,
  route: '/menu',
  title: 'Menu — Test Cast Cafe',
  outline: 'h1: Our Menu\nh2: Drinks\nh2: Pastries\nnav (Main): Home | Menu | Contact\nbuttons: Order now\nlist: 6 items',
}

const payload = {
  projectId: SLUG,
  type: 'bug',
  body: 'e2e-72b capture wire check — safe to ignore',
  pageUrl: 'https://test-cafe.example.com/menu?utm=should-not-matter',
  userAgent: 'e2e-72b/1.0',
  viewport: '1200x900',
  website: '',
  _ts: Date.now() - 5_000,
  capture,
}

const res = await fetch(`${BASE}/api/feedback`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-vercel-protection-bypass': token,
  },
  body: JSON.stringify(payload),
})
const data = await res.json().catch(() => ({}))
if (res.status !== 201 || !data.id) {
  console.error(`FAIL: expected 201 with id, got ${res.status}:`, data)
  process.exit(1)
}
console.log(`POST /api/feedback → 201, feedback id ${data.id}`)

// Give Firestore a beat, then verify both rows.
await new Promise((r) => setTimeout(r, 1500))

const fbDoc = await db.collection('feedback').doc(data.id).get()
if (!fbDoc.exists) {
  console.error('FAIL: feedback row not found')
  process.exit(1)
}
const fb = fbDoc.data()
const ctxSnap = await db
  .collection('prototype_context')
  .where('feedback_id', '==', data.id)
  .get()

let failed = false
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failed = true
}

check('feedback row has has_capture: true', fb.has_capture === true)
check('feedback row does NOT carry the capture itself', fb.capture === undefined)
check('exactly one prototype_context row', ctxSnap.size === 1)
if (ctxSnap.size === 1) {
  const row = ctxSnap.docs[0].data()
  check('project_id is the slug', row.project_id === SLUG)
  check("source is 'loop-widget'", row.source === 'loop-widget')
  check('route preserved', row.route === '/menu')
  check('outline preserved', typeof row.outline === 'string' && row.outline.includes('h2: Pastries'))
  check("status is 'active'", row.status === 'active')
  check('capture_version is 1', row.capture_version === 1)
}

// Clean up the rows this test created.
await fbDoc.ref.delete()
for (const d of ctxSnap.docs) await d.ref.delete()
console.log('cleaned up test rows')

process.exit(failed ? 1 : 0)
