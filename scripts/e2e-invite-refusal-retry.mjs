#!/usr/bin/env node
// A refused invite should send one POST and show its message at once.
//
// Before the fix, the app's mutation default (retry: 1, lib/query/query-client.ts)
// sent the refused POST twice, a second apart, so the Invite window showed its
// message about 1.3 seconds late. useShareProject now sets retry: false. This
// script counts the POSTs and times the message on preview. Graded, nothing
// adjusted to pass.
//
// One throwaway brief: a second member is added and removed by API, then the
// Invite window is asked to invite that removed address (the server answers 409).
//
// Needs .ibuild4you-bypass and .test-admin-password only (no test cast).
// Headless Chromium only. Screenshots go to E2E_SHOT_DIR.
// Usage: E2E_SHOT_DIR=<dir> node scripts/e2e-invite-refusal-retry.mjs

import { mkdirSync } from 'node:fs'
import { launchLoggedIn, BASE, shotDir } from './lib/preview-login.mjs'

const SHOTS = process.env.E2E_SHOT_DIR || shotDir
mkdirSync(SHOTS, { recursive: true })

const stamp = Math.floor(performance.now()).toString(36)
const MAKER = 'test-originator@ibuild4you.com'
const SECOND = 'test-contributor@ibuild4you.com'
const MSG = 'This person was removed from the brief. Restore them under People instead of inviting them again.'

let failures = 0
const grade = (ok, label, evidence) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${evidence ? `  [${evidence}]` : ''}`)
  if (!ok) failures++
}
const note = (label, evidence) => console.log(`NOTE: ${label}${evidence ? `  [${evidence}]` : ''}`)

const { browser, page } = await launchLoggedIn()

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

let proj = null
let auth = null
try {
  // ===== Setup: a brief with a maker =====
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: `e2e invite refusal ${stamp} — delete me`,
    requester_email: MAKER,
    requester_first_name: 'Mara',
  }))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  proj = await resp.json()
  auth = resp.request().headers()['authorization']
  console.log(`created ${proj.id} (${proj.slug})`)

  // ===== Add the second member, then remove them (both by API) =====
  const add = await call(page, auth, 'POST', '/api/projects/share', {
    project_id: proj.id, email: SECOND, first_name: 'Tomas', brief_role: 'contributor',
  })
  grade(add.status() === 200, 'setup: second member added', `status ${add.status()}`)
  const roster = await (await call(page, auth, 'GET', `/api/projects/${proj.id}/members`)).json()
  const member = (roster.members || []).find((m) => m.email === SECOND)
  if (!member) throw new Error('second member not found in the roster')
  const rm = await call(page, auth, 'DELETE', `/api/projects/${proj.id}/members/${member.id}`)
  grade(rm.status() === 200, 'setup: second member removed', `status ${rm.status()}`)

  // Count share POSTs from here on. The API calls above go through
  // page.request, which does not fire page.on('request'); registering after
  // them keeps the count unambiguous.
  let posts = 0
  page.on('request', (r) => {
    if (/\/api\/projects\/share$/.test(r.url()) && r.method() === 'POST') posts++
  })

  // ===== Invite the removed address from the Invite window =====
  await page.goto(`${BASE}/projects/${proj.slug}?tab=settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Invite', exact: true }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('input[placeholder="First name"]').fill('Tomas')
  await dlg.locator('input[type="email"]').fill(SECOND)

  const shareP = page
    .waitForResponse((r) => /\/api\/projects\/share$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  const tClick = Date.now()
  await dlg.getByRole('button', { name: 'Share', exact: true }).click()
  const shareResp = await shareP
  const tResp = Date.now()
  await dlg.getByText(MSG).first().waitFor({ timeout: 10000 }).catch(() => {})
  const tMsg = Date.now()

  // Longer than React Query's 1000 ms retry delay plus a round trip, so a
  // second POST would have been sent by now.
  await page.waitForTimeout(2500)

  grade(posts === 1, 'one POST for one refused invite', `${posts} POST(s)`)
  grade(shareResp?.status() === 409, 'the invite answers 409', `status ${shareResp?.status()}`)
  grade(tMsg - tResp < 500, 'message within 500 ms of the 409', `${tMsg - tResp} ms`)
  note('time from the click to the message on screen', `${tMsg - tClick} ms`)
  grade(
    (await dlg.count()) === 1 && (await dlg.locator('input[type="email"]').inputValue()) === SECOND,
    'the window stays open with the address still in the form'
  )
  await page.screenshot({ path: `${SHOTS}/invite-refusal.png` })
  await page.keyboard.press('Escape')
} catch (e) {
  grade(false, `script error: ${String(e.message).split('\n')[0]}`)
  await page.screenshot({ path: `${SHOTS}/error.png` }).catch(() => {})
} finally {
  if (proj && auth) {
    const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, { headers: { authorization: auth } })
    console.log(`cleanup DELETE → ${del.status()}`)
  }
  await browser.close()
}
console.log(failures ? `FAILED: ${failures} check(s)` : 'PASS: all checks')
process.exit(failures ? 1 : 0)
