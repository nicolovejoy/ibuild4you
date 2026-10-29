#!/usr/bin/env node
// #229 — brief curation: notes + paste guard. Walk-through, graded:
//   1. Throwaway brief with a small brief, one user message sent through /api/chat.
//   2. POST /api/briefs/notes -> 200, a note is written (calls the real model once).
//   3. GET /api/briefs/notes -> exactly 1 unfolded note.
//   4. PUT /api/briefs with a prep_stamp that omits the note -> 409 stale_prep
//      naming the note as unlisted.
//   5. Same PUT with force: true -> 200; the note stays unfolded (unlisted notes
//      are never folded).
//   6. PUT with a full stamp at the new live version -> 200; the note is folded.
//   7. GET -> 0 unfolded.
// The throwaway brief is deleted at the end, pass or fail.
// Needs .ibuild4you-bypass + .test-admin-password (the admin resolves to owner,
// which can chat). Preview has FEEDBACK_NOTIFY_SUPPRESS on.
// Usage: node scripts/e2e-229-notes.mjs

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const TITLE = `E2E229 notes ${stamp} — delete me`

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()
let projectId = null
let auth = null

// Errors are cut to their first line: Playwright's full error echoes headers
// (Bearer token, bypass cookie).
const call = (method, path, data) =>
  page.request
    .fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    .catch((e) => {
      throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`)
    })

const BRIEF = {
  problem: 'Dog walkers cannot take bookings online',
  target_users: 'Local dog owners',
  features: ['Booking page'],
  constraints: 'Mobile first',
  additional_context: '',
  decisions: [],
  open_risks: [],
}

try {
  // Create through the Import JSON modal, which also captures the builder token.
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: TITLE,
    welcome_message: `Hello ${stamp}, tell me about your idea.`,
    brief: BRIEF,
  }))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  const proj = await resp.json()
  projectId = proj.id
  auth = resp.request().headers()['authorization']
  console.log(`created ${proj.id} (${proj.slug})`)

  // One user message via /api/chat (the admin chats as owner). The reply
  // streams; reading the body to the end means the turn is stored.
  const sessions = await (await call('GET', `/api/sessions?project_id=${projectId}`)).json()
  const sessionId = sessions[0]?.id
  if (!sessionId) throw new Error('no session on the new brief')
  const chat = await call('POST', '/api/chat', {
    session_id: sessionId,
    content: `I also want customers to get a text reminder the day before a walk (${stamp}).`,
  })
  await chat.text().catch(() => '')
  grade(chat.status() === 200, `POST /api/chat -> ${chat.status()}`)

  // Write the note.
  const noteRes = await call('POST', '/api/briefs/notes', { project_id: projectId })
  grade(noteRes.status() === 200, `POST /api/briefs/notes -> ${noteRes.status()}`)

  const listNotes = async () => (await call('GET', `/api/briefs/notes?project_id=${projectId}`)).json()
  let n = await listNotes()
  grade(Array.isArray(n.notes) && n.notes.length === 1, `1 unfolded note (got ${n.notes?.length})`)
  const noteId = n.notes?.[0]?.id
  const v0 = n.brief_version

  const put = (body) => call('PUT', '/api/briefs', { project_id: projectId, content: BRIEF, source: 'paste', ...body })

  // Stamp omitting the note -> stale.
  const stale = await put({ prep_stamp: { brief_version: v0, note_ids: [] } })
  const staleBody = await stale.json().catch(() => ({}))
  grade(stale.status() === 409 && staleBody.error === 'stale_prep', `PUT with a stamp missing the note -> ${stale.status()} stale_prep`)
  grade(JSON.stringify(staleBody.unlisted_notes || []).includes(noteId), '409 names the note as unlisted')

  // Save anyway: 200, note not folded.
  const forced = await put({ prep_stamp: { brief_version: v0, note_ids: [] }, force: true })
  grade(forced.status() === 200, `PUT with force -> ${forced.status()}`)
  n = await listNotes()
  grade(n.notes?.length === 1, 'forced save leaves the unlisted note unfolded')

  // Full stamp at the new live version -> folded.
  const full = await put({ prep_stamp: { brief_version: n.brief_version, note_ids: [noteId] } })
  grade(full.status() === 200, `PUT with a full stamp -> ${full.status()}`)
  n = await listNotes()
  grade(n.notes?.length === 0, `0 unfolded notes after the stamped paste (got ${n.notes?.length})`)
} catch (e) {
  console.error(`FAIL: ${e.message}`)
  failures++
} finally {
  if (projectId && auth) {
    const del = await call('DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
