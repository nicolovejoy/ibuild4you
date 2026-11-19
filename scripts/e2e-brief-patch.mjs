#!/usr/bin/env node
// Relay project 4: brief_patch. Walk-through on the Brief tab, graded:
//   1. Throwaway brief with two decisions (one locked), two features, one risk.
//   2. Paste a stamped patch that revises a decision, adds a risk and drops a
//      feature. The line under the paste box says so before Import; Import
//      saves one new version holding exactly those changes.
//   3. Paste a patch whose drop matches nothing. The line says it will not
//      import; Import shows the refusal; the version does not move.
//   4. Paste a patch aimed at the locked decision. The line says the lock
//      stays; after Import the lock is word for word as it was.
//   5. Paste a whole brief that leaves out the unlocked decision. The line
//      names it as removed (not imported).
// The throwaway brief is deleted at the end, pass or fail.
// Needs .ibuild4you-bypass + .test-admin-password.
// Usage: node scripts/e2e-brief-patch.mjs

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const TITLE = `E2E brief patch ${stamp} — delete me`

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()
let projectId = null
let auth = null
// Count every brief save the page sends, to catch a save sent twice.
let briefPuts = 0
page.on('request', (r) => {
  if (/\/api\/briefs$/.test(r.url()) && r.method() === 'PUT') briefPuts++
})

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
  features: ['Booking page', 'Text reminders'],
  constraints: 'Mobile first',
  additional_context: '',
  decisions: [
    { topic: 'Payment', decision: 'Cash only', locked: true },
    { topic: 'Opening hours', decision: 'Weekdays 9 to 5' },
  ],
  open_risks: [{ text: 'Who answers the phone on weekends?', owner: 'maker' }],
}

try {
  // Create through the Import JSON modal, which also captures the builder token.
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(
    JSON.stringify({ _payload_type: 'new-project', title: TITLE, welcome_message: `Hello ${stamp}.`, brief: BRIEF })
  )
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

  const liveBrief = async () => (await call('GET', `/api/briefs?project_id=${projectId}`)).json()
  const v0 = (await liveBrief()).version

  // Open the brief's page, Brief tab.
  await page.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
  const briefTab = page.getByRole('button', { name: /^Brief$/ }).or(page.getByRole('tab', { name: /^Brief$/ })).first()
  await briefTab.waitFor({ timeout: 15000 })
  await briefTab.click()
  const box = page.locator('textarea[placeholder*="prep chat"]')
  await box.waitFor({ timeout: 10000 })
  // The preview needs the live brief in the tab; wait for the version line.
  await page.getByTestId('brief-version').filter({ hasText: `v${v0}` }).waitFor({ timeout: 10000 })

  const line = (id) => page.getByTestId(`paste-${id}`)
  const textOf = async (id) => ((await line(id).count()) ? (await line(id).first().textContent())?.trim() : null)
  const importAndWait = async () => {
    const put = page
      .waitForResponse((r) => /\/api\/briefs$/.test(r.url()) && r.request().method() === 'PUT', { timeout: 15000 })
      .catch(() => null)
    await page.getByRole('button', { name: 'Import JSON' }).click()
    const r = await put
    await page.waitForTimeout(800)
    return r
  }
  const payload = (version, patch) =>
    JSON.stringify({ _payload_type: 'next-convo', _prep_stamp: { brief_version: version, note_ids: [] }, brief_patch: patch })

  // --- 2. A patch that revises, adds and drops ---
  await box.fill(
    payload(v0, {
      decisions: [{ topic: 'opening hours', decision: 'Every day 8 to 6' }],
      open_risks: [{ text: 'Is a card reader needed later?', owner: 'builder' }],
      drop: { features: ['text reminders'] },
    })
  )
  const changes = await textOf('changes')
  grade(changes === 'Changes: 1 decision revised · 1 risk added · 1 feature dropped', `preview line: ${changes}`)
  let r = await importAndWait()
  grade(r?.status() === 200, `Import a patch -> ${r?.status()}`)
  let b = await liveBrief()
  const v1 = b.version
  grade(v1 === v0 + 1, `one new version (v${v0} -> v${v1})`)
  const hours = b.content.decisions.find((d) => d.topic === 'Opening hours')
  grade(hours?.decision === 'Every day 8 to 6', 'decision revised under its stored topic')
  grade(typeof hours?.revised_at === 'string', 'the revision is stamped')
  grade(JSON.stringify(b.content.features) === JSON.stringify(['Booking page']), `feature dropped: ${JSON.stringify(b.content.features)}`)
  grade(b.content.open_risks.length === 2, `risk added (${b.content.open_risks.length} risks)`)
  grade(b.content.problem === BRIEF.problem && b.content.constraints === BRIEF.constraints, 'fields the patch left out are unchanged')

  // The import may have handed off to the Conversations tab; come back.
  await page.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
  await briefTab.waitFor({ timeout: 15000 })
  await briefTab.click()
  await box.waitFor({ timeout: 10000 })
  await page.getByTestId('brief-version').filter({ hasText: `v${v1}` }).waitFor({ timeout: 10000 })

  // --- 3. A drop that matches nothing ---
  await box.fill(payload(v1, { features: ['Gift cards'], drop: { open_risks: ['No such risk in this brief'] } }))
  const putsBefore = briefPuts
  const unmatched = await textOf('unmatched')
  grade(!!unmatched && unmatched.startsWith('Will not import:') && unmatched.includes('No such risk in this brief'), `preview refusal: ${unmatched}`)
  r = await importAndWait()
  grade(r?.status() === 400, `Import with an unmatched drop -> ${r?.status()}`)
  // Read from the page text: a getByText locator did not resolve on this
  // message although it is on screen.
  const shown = await page
    .waitForFunction(() => document.body.innerText.includes('Not imported: no risk in the brief reads'), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  grade(shown, 'the refusal is shown after Import')
  // A refused save must not be sent again (the app's default retries a failed
  // mutation once; the brief save opts out).
  await page.waitForTimeout(2500)
  grade(briefPuts === putsBefore + 1, `the refused save was sent once (${briefPuts - putsBefore})`)
  b = await liveBrief()
  grade(b.version === v1, `version did not move (v${b.version})`)
  grade(!b.content.features.includes('Gift cards'), 'nothing from the refused patch was applied')

  // --- 4. A patch aimed at the locked decision ---
  await box.fill(payload(v1, { decisions: [{ topic: 'Payment', decision: 'Cards too' }], queued: ['Loyalty stamps'] }))
  const locks = await textOf('locks')
  grade(locks === 'Locked, left as it is: "Payment".', `preview lock line: ${locks}`)
  r = await importAndWait()
  grade(r?.status() === 200, `Import a patch aimed at a lock -> ${r?.status()}`)
  b = await liveBrief()
  const pay = b.content.decisions.find((d) => d.topic === 'Payment')
  grade(pay?.decision === 'Cash only' && pay?.locked === true, 'the locked decision is word for word as it was')
  grade(JSON.stringify(b.content.queued) === JSON.stringify(['Loyalty stamps']), 'the rest of that patch was applied')
  const v2 = b.version

  await page.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
  await briefTab.waitFor({ timeout: 15000 })
  await briefTab.click()
  await box.waitFor({ timeout: 10000 })
  await page.getByTestId('brief-version').filter({ hasText: `v${v2}` }).waitFor({ timeout: 10000 })

  // --- 5. A whole rewrite that leaves a decision out (preview only) ---
  await box.fill(
    JSON.stringify({
      _payload_type: 'next-convo',
      _prep_stamp: { brief_version: v2, note_ids: [] },
      brief: { ...BRIEF, decisions: [] },
    })
  )
  const rewrite = await textOf('rewrite')
  grade(rewrite === 'Whole rewrite: removes 1 decision: "Opening hours"', `whole-rewrite line: ${rewrite}`)
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
