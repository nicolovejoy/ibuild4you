#!/usr/bin/env node
// 👎 signal for the builder — driven from the maker's own page.
// Walk-through, graded:
//   1. Throwaway brief; the maker signs in, sends one message, Sam replies.
//   2. The maker taps 👎 on Sam's reply, types a reason in the "What was off?"
//      box and sends it -> the message carries rating 'down' + rating_reason.
//   3. The builder's dashboard list shows thumbs_down_count 1.
//   4. The builder writes a note now -> the note lists the 👎 with the reason.
//   5. The maker switches to 👍 -> reason dropped, count back to 0.
// Calls the real model (one reply, one note). Deletes the brief at the end,
// pass or fail.
// Needs .test-cast-passwords.json; without it prints SKIPPED and exits 0.
// Usage: node scripts/e2e-thumbs-down-signal.mjs

import { existsSync } from 'node:fs'
import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, ROOT } from './lib/preview-login.mjs'

if (!existsSync(`${ROOT}.test-cast-passwords.json`)) {
  console.log('SKIPPED: no test cast passwords')
  process.exit(0)
}

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = 'test-originator@ibuild4you.com'
const TITLE = `E2E thumbs-down ${stamp} — delete me`
const REASON = 'you asked that already'

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
    welcome_message: `Hey Mara, tell me about your idea (${stamp}).`,
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

  const sessions = await (await call(page, bAuth, 'GET', `/api/sessions?project_id=${projectId}`)).json()
  const sid = sessions[0].id
  const msgsOf = async () => {
    const m = await (await call(page, bAuth, 'GET', `/api/messages?session_id=${sid}`)).json()
    return Array.isArray(m) ? m : []
  }
  const myRow = async () => {
    const list = await (await call(page, bAuth, 'GET', '/api/projects')).json()
    return list.find((p) => p.id === projectId)
  }

  // 1. Maker signs in and sends one message; wait for Sam's reply.
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
  let reply = null
  for (let i = 0; i < 20 && !reply; i++) {
    await mpage.waitForTimeout(3000)
    const agents = (await msgsOf()).filter((m) => m.role === 'agent')
    if (agents.length >= 2) reply = agents[agents.length - 1]
  }
  grade(!!reply, 'Sam replied to the maker')
  if (!reply) throw new Error('no reply to rate')
  // Reload so the reply renders from the saved messages (with its id), and
  // wait until both agent messages (welcome + reply) show their thumbs.
  await mpage.reload({ waitUntil: 'domcontentloaded' })
  const downs = mpage.getByTitle('Not helpful')
  for (let i = 0; i < 15 && (await downs.count()) < 2; i++) await mpage.waitForTimeout(1000)
  grade((await downs.count()) === 2, `both of Sam's messages show thumbs -> ${await downs.count()}`)

  // 2. 👎 on the reply (the second agent message), then the reason.
  await downs.nth(1).click()
  const reasonBox = mpage.getByPlaceholder('What was off? (optional)')
  grade(await reasonBox.isVisible().catch(() => false), 'the "What was off?" box opens after 👎')
  await reasonBox.fill(REASON)
  await mpage.getByRole('button', { name: 'Send feedback' }).click()
  await mpage.waitForTimeout(2500)
  const rated = (await msgsOf()).find((m) => m.id === reply.id)
  grade(rated?.rating === 'down' && rated?.rating_reason === REASON, `the reply carries 👎 and the reason -> ${rated?.rating}/${rated?.rating_reason}`)
  grade(await mpage.getByText(`“${REASON}”`).isVisible().catch(() => false), 'the maker sees their reason under the reply')

  // 3. Dashboard row count.
  grade((await myRow())?.thumbs_down_count === 1, 'the dashboard row counts one 👎')

  // 4. Write a note now; it lists the 👎 with the reason.
  const noteRes = await call(page, bAuth, 'POST', '/api/briefs/notes', { project_id: projectId })
  grade(noteRes.status() === 200, `write note now -> ${noteRes.status()}`)
  const notes = (await (await call(page, bAuth, 'GET', `/api/briefs/notes?project_id=${projectId}`)).json()).notes ?? []
  const td = notes.flatMap((n) => n.thumbs_down ?? [])
  grade(td.length === 1 && td[0].reason === REASON && td[0].excerpt.length > 0, `the note lists the 👎 with the reason -> ${JSON.stringify(td).slice(0, 160)}`)

  // 5. Switch to 👍: reason dropped, count back to 0.
  await mpage.getByTitle('Helpful').nth(1).click()
  await mpage.waitForTimeout(2500)
  const flipped = (await msgsOf()).find((m) => m.id === reply.id)
  grade(flipped?.rating === 'up' && !flipped?.rating_reason, 'switching to 👍 drops the reason')
  grade(((await myRow())?.thumbs_down_count ?? 0) === 0, 'the dashboard count goes back to 0')

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
