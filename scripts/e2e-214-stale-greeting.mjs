#!/usr/bin/env node
// #214 — stale-greeting guard. When a maker returns and the builder has not
// queued the next conversation (no ferry-desk paste newer than the maker's last
// message), kickoff posts a canned "nothing queued yet" note instead of a model
// greeting; the dashboard shows "Maker waiting"; a later import swaps the note
// for the new welcome. Walk-through, graded:
//   1. Maker sends one message in session 1 (creates maker history).
//   2. Builder starts session 2 without importing (empty return session).
//   3. Maker kickoff on session 2 -> canned greeting, kind 'unqueued_greeting',
//      projects.maker_waiting_since set, dashboard row says "Maker waiting".
//   4. Builder PATCHes payload_pasted_at + a NEW welcome_message -> greeting gone,
//      new welcome in the same session, maker_waiting_since cleared.
// Needs .test-cast-passwords.json; without it prints SKIPPED and exits 0.
// Preview has FEEDBACK_NOTIFY_SUPPRESS on, so the run emails nobody.
// Usage: node scripts/e2e-214-stale-greeting.mjs

import { existsSync } from 'node:fs'
import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, ROOT } from './lib/preview-login.mjs'

if (!existsSync(`${ROOT}.test-cast-passwords.json`)) {
  console.log('SKIPPED: no test cast passwords')
  process.exit(0)
}

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = 'test-originator@ibuild4you.com'
const TITLE = `E2E214 stale greeting ${stamp} — delete me`
const W1 = `Hey Mara, round one hello ${stamp}.`
const W2 = `Round two ${stamp}: here is what we queued for you.`

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
const call = (pg, auth, method, path, data) =>
  pg.request
    .fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    .catch((e) => {
      throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`)
    })

try {
  // Create the brief through the Import JSON modal (captures the builder token).
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: TITLE,
    requester_email: EMAIL,
    requester_first_name: 'Mara',
    welcome_message: W1,
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

  const bGet = async (path) => (await call(page, bAuth, 'GET', path)).json()
  const getProject = () => bGet(`/api/projects?slug=${proj.slug}`)

  // Maker signs in and sends one message (maker history + last_maker_message_at).
  const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const mpage = await mctx.newPage()
  let mAuth = null
  mpage.on('request', (r) => {
    const a = r.headers()['authorization']
    if (a && r.url().includes('/api/')) mAuth = a
  })
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
  await box.fill('I want a booking page for my dog-walking service.')
  await box.press('Enter')
  await mpage.waitForTimeout(22000)
  if (!mAuth) throw new Error('no maker Bearer token captured')

  let p = await getProject()
  grade(typeof p.last_maker_message_at === 'string', 'maker history exists (last_maker_message_at set)')
  grade(!p.maker_waiting_since, 'no maker_waiting_since before the return visit')

  // Builder starts session 2 without importing: empty return session.
  const s2res = await call(page, bAuth, 'POST', '/api/sessions', { project_id: projectId })
  if (s2res.status() !== 201) throw new Error(`POST /api/sessions -> ${s2res.status()}`)
  const s2 = (await s2res.json()).id
  const msgsOf = async (sid) => {
    const m = await (await call(page, bAuth, 'GET', `/api/messages?session_id=${sid}`)).json()
    return Array.isArray(m) ? m : []
  }
  grade((await msgsOf(s2)).length === 0, 'session 2 starts empty (welcome already used in session 1)')

  // Maker kickoff on the empty session: canned greeting, not a model greeting.
  const ko = await call(mpage, mAuth, 'POST', '/api/chat/kickoff', { session_id: s2 })
  console.log(`kickoff -> ${ko.status()} ${(ko.headers()['content-type'] || '').split(';')[0]}`)
  await ko.text().catch(() => '')
  const after = await msgsOf(s2)
  const canned = after.filter((m) => m.kind === 'unqueued_greeting')
  grade(canned.length === 1 && canned[0].role === 'agent', 'kickoff stored one agent message with kind unqueued_greeting')
  grade(canned.length === 1 && /hasn't queued our next conversation yet/.test(canned[0].content || ''),
    'greeting says "hasn\'t queued our next conversation yet"')

  p = await getProject()
  grade(typeof p.maker_waiting_since === 'string', 'projects.maker_waiting_since is set')

  // Builder dashboard row shows the maker-waiting state.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const dash = await page.locator('body').innerText().catch(() => '')
  grade(dash.includes('Maker waiting — nothing queued'), 'dashboard shows "Maker waiting — nothing queued"')

  // Builder pastes: PATCH payload_pasted_at + a new welcome re-arms the session.
  const patch = await call(page, bAuth, 'PATCH', '/api/projects', {
    project_id: projectId,
    payload_pasted_at: new Date().toISOString(),
    welcome_message: W2,
  })
  grade(patch.status() === 200, `PATCH import -> ${patch.status()}`)
  const msgs2 = await msgsOf(s2)
  grade(!msgs2.some((m) => m.kind === 'unqueued_greeting'), 'canned greeting removed from the session')
  grade(msgs2.length === 1 && msgs2[0].role === 'agent' && msgs2[0].content === W2,
    'new welcome posted verbatim in the same session')
  p = await getProject()
  grade(!p.maker_waiting_since, 'maker_waiting_since cleared after import')

  await mctx.close()
} catch (e) {
  console.error(`FAIL: ${e.message}`)
  failures++
} finally {
  if (projectId && bAuth) {
    const del = await call(page, bAuth, 'DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
