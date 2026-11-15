#!/usr/bin/env node
// Relay efficiency, project 1 PR B — what a note records. A behaviour probe of
// the real note writer on preview, graded:
//   1. Throwaway brief with one two-part decision ("Bar ranges") and one
//      maker-owned open risk ("Start over button?").
//   2. The maker signs in and, in one message, answers the risk, changes one
//      part of the decision, and promises to send something later.
//   3. The builder writes the note (POST /api/briefs/notes, real model).
//   4. The note must: settle the risk WITH its answer; restate the revised
//      decision whole (the untouched part is still there); and carry the
//      promise as a maker-owned open risk.
// Calls the real model twice (Sam's reply, then the note). Deletes the brief at
// the end, pass or fail. The grades are on model output, so a single FAIL means
// "read the printed note", not necessarily a regression.
// Needs .test-cast-passwords.json; without it prints SKIPPED and exits 0.
// Usage: node scripts/e2e-relay-note-answers.mjs

import { existsSync } from 'node:fs'
import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, ROOT } from './lib/preview-login.mjs'

if (!existsSync(`${ROOT}.test-cast-passwords.json`)) {
  console.log('SKIPPED: no test cast passwords')
  process.exit(0)
}

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = 'test-originator@ibuild4you.com'
const TITLE = `E2E note answers ${stamp} — delete me`

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()
let projectId = null
let bAuth = null

// Errors are cut to their first line: Playwright's full error echoes headers
// (Bearer token, bypass cookie).
const call = (method, path, data) =>
  page.request
    .fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: bAuth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    .catch((e) => {
      throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`)
    })

try {
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: TITLE,
    requester_email: EMAIL,
    requester_first_name: 'Mara',
    welcome_message: `Hey Mara, two quick things to settle ${stamp}.`,
    brief: {
      problem: 'Piano students need a practice game for reading notes.',
      target_users: 'Piano students',
      features: ['Treble game', 'Bass game'],
      constraints: '',
      additional_context: '',
      decisions: [
        { topic: 'Bar ranges', decision: 'The treble game covers bars 1 to 217. The bass game covers bars 1 to 205.' },
      ],
      open_risks: [{ text: 'Should the results page have a Start over button?', owner: 'maker' }],
    },
  }))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  const proj = await resp.json()
  projectId = proj.id
  bAuth = resp.request().headers()['authorization']
  console.log(`created ${proj.id} (${proj.slug})`)

  // The maker answers the risk, changes one part of the decision, and promises a follow-up.
  const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const mpage = await mctx.newPage()
  await loginWithPassword(mpage, { email: EMAIL, password: readCastPassword(EMAIL), path: `/projects/${proj.slug}` })
  const box = mpage.getByPlaceholder('Type a message...')
  for (let i = 0; i < 20; i++) {
    if (await box.isVisible().catch(() => false)) break
    if ((await mpage.locator('body').innerText().catch(() => '')).includes('What should we call you?')) {
      await mpage.locator('input:visible').first().fill('Mara')
      await mpage.getByRole('button', { name: 'Continue' }).click()
    }
    await mpage.waitForTimeout(2000)
  }
  if (!(await box.isVisible().catch(() => false))) throw new Error('composer never appeared')
  await box.fill(
    'Yes, please add a Start over button on the results page. Also the bass game should stop at bar 180 now, the treble range stays as it is. And I will send you the recital date next week.'
  )
  await box.press('Control+Enter')
  await mpage.waitForTimeout(22000)
  await mctx.close()

  const noteRes = await call('POST', '/api/briefs/notes', { project_id: projectId })
  grade(noteRes.status() === 200, `POST /api/briefs/notes -> ${noteRes.status()}`)
  const { notes = [] } = await (await call('GET', `/api/briefs/notes?project_id=${projectId}`)).json()
  grade(notes.length === 1, `one unfolded note (got ${notes.length})`)
  const note = notes[0] ?? { decisions: [], risks_added: [], risks_resolved: [] }
  console.log(JSON.stringify({ text: note.text, decisions: note.decisions, risks_added: note.risks_added, risks_resolved: note.risks_resolved }, null, 2))

  const settled = (note.risks_resolved ?? []).find((r) => /start over/i.test(typeof r === 'string' ? r : r.text))
  grade(!!settled, 'the Start over risk is marked settled')
  grade(
    !!settled && typeof settled === 'object' && typeof settled.resolution === 'string' && settled.resolution.trim().length > 0,
    'the settled risk carries its answer'
  )

  const bars = (note.decisions ?? []).find((d) => d.topic.trim().toLowerCase() === 'bar ranges')
  grade(!!bars, 'the revision reuses the brief topic "Bar ranges"')
  grade(!!bars && /180/.test(bars.decision), 'the revised decision has the new bass range (180)')
  grade(!!bars && /217/.test(bars.decision), 'the revised decision still has the untouched treble range (217)')

  const owed = (note.risks_added ?? []).find((r) => /recital/i.test(typeof r === 'string' ? r : r.text))
  grade(!!owed, 'the promised recital date is an open risk')
  grade(!!owed && typeof owed === 'object' && owed.owner === 'maker', 'and it is owned by the maker')
} catch (e) {
  console.error(`FAIL: ${e.message}`)
  failures++
} finally {
  if (projectId && bAuth) {
    const del = await call('DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
