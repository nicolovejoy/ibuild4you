#!/usr/bin/env node
// #177 + #254 — the maker's return greeting, driven from the maker's own page
// (so the client-side shouldKickoff decides, then the server re-validates).
// Walk-through, graded:
//   1. Throwaway brief; the maker signs in and sends one message in session 1.
//   2. The builder marks the next round queued (payload_pasted_at), so returns
//      take the model greeting rather than the #214 nothing-queued note.
//   3. #177: the builder starts session 2 (empty). The maker opens the brief ->
//      Sam greets on its own (one agent message, not the canned note).
//   4. #254: the builder starts session 3 and posts a note with "Sam replies"
//      off. The maker opens the brief -> Sam still greets (before #254 the note
//      read as "maker mid-turn" and nothing happened).
// Calls the real model twice (plus the maker's first turn). Deletes the brief
// at the end, pass or fail.
// Needs .test-cast-passwords.json; without it prints SKIPPED and exits 0.
// Usage: node scripts/e2e-177-254-return-greeting.mjs

import { existsSync } from 'node:fs'
import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, ROOT } from './lib/preview-login.mjs'

if (!existsSync(`${ROOT}.test-cast-passwords.json`)) {
  console.log('SKIPPED: no test cast passwords')
  process.exit(0)
}

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = 'test-originator@ibuild4you.com'
const TITLE = `E2E177-254 return greeting ${stamp} — delete me`

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
    welcome_message: `Hey Mara, round one hello ${stamp}.`,
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

  const msgsOf = async (sid) => {
    const m = await (await call(page, bAuth, 'GET', `/api/messages?session_id=${sid}`)).json()
    return Array.isArray(m) ? m : []
  }
  const newSession = async () => {
    const r = await call(page, bAuth, 'POST', '/api/sessions', { project_id: projectId })
    if (r.status() !== 201) throw new Error(`POST /api/sessions -> ${r.status()}`)
    return (await r.json()).id
  }

  // 1. Maker signs in and sends one message (maker history).
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
  await box.fill('I want a booking page for my dog-walking service.')
  await box.press('Control+Enter')
  await mpage.waitForTimeout(22000)
  // The maker leaves; a fresh page per visit so no in-memory state carries over.
  await mpage.close()

  // 2. The builder queues the next round (no new welcome, so return sessions
  // start empty and the kickoff greets).
  const patch = await call(page, bAuth, 'PATCH', '/api/projects', {
    project_id: projectId,
    payload_pasted_at: new Date().toISOString(),
  })
  grade(patch.status() === 200, `builder queues the next round -> ${patch.status()}`)

  // The maker opens the brief in a fresh page and we wait for Sam's greeting.
  const visit = async (sid) => {
    const p = await mctx.newPage()
    await p.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < 15; i++) {
      await p.waitForTimeout(3000)
      if ((await msgsOf(sid)).some((m) => m.role === 'agent')) break
    }
    await p.close()
    return msgsOf(sid)
  }
  const isModelGreeting = (m) => m.role === 'agent' && m.kind !== 'unqueued_greeting' && (m.content || '').trim().length > 0

  // 3. #177: an empty return session gets a greeting on open.
  const s2 = await newSession()
  grade((await msgsOf(s2)).length === 0, 'session 2 starts empty')
  const after2 = await visit(s2)
  grade(after2.length === 1 && isModelGreeting(after2[0]), '#177: Sam greets the maker in the empty return session')
  if (after2[0]) console.log(`  greeting: ${String(after2[0].content).slice(0, 160)}`)

  // 4. #254: a builder note left in the session does not stop the greeting.
  const s3 = await newSession()
  const note = await call(page, bAuth, 'POST', '/api/chat', {
    session_id: s3,
    content: 'When Mara is back, ask which neighbourhoods she covers.',
    reply: false,
  })
  grade(note.status() === 201, `builder posts a note with Sam replies off -> ${note.status()}`)
  const before3 = await msgsOf(s3)
  grade(before3.length === 1 && before3[0].sender_side === 'builder', 'the note is stored tagged builder-side')
  const after3 = await visit(s3)
  const greetings3 = after3.filter(isModelGreeting)
  grade(greetings3.length === 1, '#254: Sam greets the maker despite the builder note')
  if (greetings3[0]) console.log(`  greeting: ${String(greetings3[0].content).slice(0, 200)}`)

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
