#!/usr/bin/env node
// What a note records when a risk is only partly answered, and when a one-line
// answer settles a risk. A behaviour probe of the real note writer on preview,
// graded. Both cases come from Danny's brief (2026-11-16 and 2026-11-17):
//   - A bundled open risk was half answered. The note listed the whole risk as
//     settled and, word for word, as a new open risk.
//   - An open risk was answered in one line. The note recorded a decision whose
//     topic was the risk's whole text.
// Steps:
//   1. Throwaway brief with two maker-owned open risks: a bundled one (does the
//      piano play; C major; A minor) and a list of placeholders to react to.
//   2. The maker signs in and, in one message, answers part of the first risk
//      (A minor not heard yet) and all of the second.
//   3. The builder writes the note (POST /api/briefs/notes, real model).
//   4. The note must: settle the bundled risk with its answer; carry what is
//      left as a NEW, narrower risk; never hold the same text in both lists;
//      never re-add a risk the brief already has; settle the placeholders risk
//      with its answer; and keep every decision topic a short label.
// Calls the real model twice (Sam's reply, then the note). Deletes the brief at
// the end, pass or fail. The grades are on model output, so a single FAIL means
// "read the printed note", not necessarily a regression.
// Needs .test-cast-passwords.json; without it prints SKIPPED and exits 0.
// Usage: node scripts/e2e-note-partial-risks.mjs

import { existsSync } from 'node:fs'
import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, ROOT } from './lib/preview-login.mjs'

if (!existsSync(`${ROOT}.test-cast-passwords.json`)) {
  console.log('SKIPPED: no test cast passwords')
  process.exit(0)
}

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = 'test-originator@ibuild4you.com'
const TITLE = `E2E note partial risks ${stamp} — delete me`

const PHRASE_RISK =
  'Phrase review page: nobody has heard the phrases yet. Does the piano play and match the notation? Which phrases sound musical in C major, and which in A minor?'
const PLACEHOLDER_RISK =
  'Placeholders to react to: the big star never says Start; the jingle is major on a minor song; pressing the star ends the fireworks.'

// A topic is a label, not a sentence. Sixty characters is generous for "a few
// words" and far below either risk's length.
const TOPIC_MAX = 60

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

// Risks compare by text, trimmed and case-insensitive, whitespace collapsed.
const textOf = (r) => (typeof r === 'string' ? r : (r?.text ?? ''))
const key = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase()

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
    welcome_message: `Hey Mara, the phrase review page is up. Two things to react to ${stamp}.`,
    brief: {
      problem: 'Piano students need a practice game for reading notes.',
      target_users: 'Piano students',
      features: ['Phrase review page'],
      constraints: '',
      additional_context: '',
      decisions: [],
      open_risks: [
        { text: PHRASE_RISK, owner: 'maker' },
        { text: PLACEHOLDER_RISK, owner: 'maker' },
      ],
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

  // The maker answers part of the first risk and all of the second.
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
    'I listened on the phrase page. The piano plays and it matches the notation. The C major phrases sound musical, a bit repetitive. I have not listened to A minor yet, I will get to it this week. And the three placeholders can all stay as they are for now.'
  )
  await box.press('Control+Enter')
  await mpage.waitForTimeout(22000)
  await mctx.close()

  const noteRes = await call('POST', '/api/briefs/notes', { project_id: projectId })
  grade(noteRes.status() === 200, `POST /api/briefs/notes -> ${noteRes.status()}`)
  const { notes = [] } = await (await call('GET', `/api/briefs/notes?project_id=${projectId}`)).json()
  grade(notes.length === 1, `one unfolded note (got ${notes.length})`)
  const note = notes[0] ?? {}
  const decisions = note.decisions ?? []
  const added = note.risks_added ?? []
  const resolved = note.risks_resolved ?? []
  console.log(JSON.stringify({ text: note.text, decisions, risks_added: added, risks_resolved: resolved }, null, 2))

  const hasAnswer = (r) => !!r && typeof r === 'object' && typeof r.resolution === 'string' && r.resolution.trim().length > 0

  // The bundled risk: settled with its answer, and what is left carried on.
  const phraseSettled = resolved.find((r) => key(textOf(r)) === key(PHRASE_RISK))
  grade(!!phraseSettled, 'the bundled phrase risk is marked settled, quoted exactly')
  grade(hasAnswer(phraseSettled), 'and it carries what the maker answered')
  const left = added.find((r) => /a minor/i.test(textOf(r)))
  grade(!!left, 'what is left (A minor) is a new open risk')
  grade(!!left && key(textOf(left)) !== key(PHRASE_RISK), 'and it is worded as only what is left, not the whole risk again')

  // Neither list repeats the other, and nothing the brief already has is re-added.
  const resolvedKeys = new Set(resolved.map((r) => key(textOf(r))))
  grade(!added.some((r) => resolvedKeys.has(key(textOf(r)))), 'no risk is in both the new and the settled list')
  const known = new Set([key(PHRASE_RISK), key(PLACEHOLDER_RISK)])
  grade(!added.some((r) => known.has(key(textOf(r)))), "no risk from the brief's open risks is added again")

  // The one-line answer: a settled risk, and no risk-length topic.
  const placeholdersSettled = resolved.find((r) => key(textOf(r)) === key(PLACEHOLDER_RISK))
  grade(!!placeholdersSettled, 'the placeholders risk is marked settled, quoted exactly')
  grade(hasAnswer(placeholdersSettled), 'and it carries what the maker answered')
  const longTopics = decisions.filter((d) => d.topic.length > TOPIC_MAX)
  grade(
    longTopics.length === 0,
    `every decision topic is a short label (${decisions.length} decision(s), longest ${Math.max(0, ...decisions.map((d) => d.topic.length))} chars)`
  )
  grade(
    !decisions.some((d) => /placeholders to react to|phrase review page/i.test(d.topic)),
    "no decision topic is an open risk's text"
  )
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
