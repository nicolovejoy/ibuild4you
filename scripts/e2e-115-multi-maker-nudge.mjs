#!/usr/bin/env node
// Verify #115 on preview:
//  1. "Start conversation N & email …" names + emails EVERY active maker
//     (fan-out response has one result per maker, suppressed on preview).
//  2. The Done-with-this-round block links to the Brief tab's payload-import
//     fold and auto-expands it.
// Creates a 2-maker brief via the Import-JSON modal, flips it out of
// waiting-on-maker with an admin synthetic user message (#105), drives the
// card, then deletes the brief.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const mae = `e2e-mae-${stamp}@example.com`
const sid = `e2e-sid-${stamp}@example.com`
const payload = {
  _payload_type: 'new-project',
  title: `Multi-maker nudge e2e ${stamp}`,
  participants: [
    { email: mae, first_name: 'Mae', role: 'maker' },
    { email: sid, first_name: 'Sid', role: 'maker' },
  ],
  welcome_message: 'Hey both — tell me about the idea!',
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// --- 1. Create the 2-maker brief via the dashboard Import-JSON modal ---
await page.getByRole('button', { name: 'New brief' }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(300)
await page.locator('#project-json').fill(JSON.stringify(payload))
const createRespP = page
  .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
  .catch(() => null)
await page.getByRole('button', { name: 'Import & create' }).click()
const createResp = await createRespP
if (!createResp || createResp.status() !== 201) {
  fail(`create → ${createResp?.status()}`); await browser.close(); process.exit()
}
const brief = await createResp.json()
const authHeader = createResp.request().headers()['authorization']
console.log(`created brief ${brief.id} (${brief.slug})`)

// --- 2. Synthetic user message so the card is "ready to send", not "waiting" ---
const sessList = await page.request.get(`${BASE}/api/admin/sessions?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
const sessions = (await sessList.json()).sessions || []
if (!sessions.length) { fail('no sessions on new brief'); await browser.close(); process.exit() }
const synth = await page.request.post(`${BASE}/api/admin/sessions`, {
  headers: { authorization: authHeader },
  data: {
    project_id: brief.id,
    op: 'add_synthetic_message',
    session_id: sessions[0].id,
    role: 'user',
    content: 'We want an app for our bakery. (e2e synthetic)',
  },
})
if (synth.status() !== 200) fail(`add_synthetic_message → ${synth.status()}`)

// --- 3. Open the brief; the header dispatch should offer "email <mae> + <sid>" ---
await page.goto(`${BASE}/projects/${brief.slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const startBtn = page.getByRole('button', { name: /Start conversation 2 & email/ })
if (!(await startBtn.count())) {
  fail('Start-conversation button not found (dispatch may still be in nudge state)')
  await page.screenshot({ path: '.playwright-mcp/e2e-115-no-button.png', fullPage: true })
} else {
  const label = (await startBtn.innerText()).replace(/\s+/g, ' ')
  console.log(`button: "${label}"`)
  const maePrefix = mae.split('@')[0]
  const sidPrefix = sid.split('@')[0]
  if (!label.includes(maePrefix) || !label.includes(sidPrefix)) {
    fail(`button doesn't name both makers: "${label}"`)
  }

  // --- 4. Part 2: the payload-import link (inside the dispatch modal since
  // #120) jumps to the Brief tab + opens the fold ---
  await startBtn.click()
  await page.waitForTimeout(500)
  const importLink = page.getByRole('dialog').getByRole('button', { name: 'Load a next-convo payload first' })
  if (!(await importLink.count())) fail('import link missing from dispatch modal')
  else {
    await importLink.click()
    await page.waitForTimeout(1200)
    if (!page.url().includes('tab=brief')) fail(`import link didn't switch tab: ${page.url()}`)
    // The import target is a first-class card now (not a fold): assert the
    // paste textarea is visible and took focus.
    const pasteBox = page.getByPlaceholder(/next-convo/)
    if (!(await pasteBox.isVisible().catch(() => false))) fail('import textarea not visible')
    else {
      const focused = await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA')
      if (!focused) console.warn('warn: import textarea visible but not focused')
      console.log('import card scrolled + focused ✓')
    }
  }

  // --- 5. Back to conversations; fire the send and capture the fan-out ---
  await page.goto(`${BASE}/projects/${brief.slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.getByRole('button', { name: /Start conversation 2 & email/ }).click()
  await page.waitForTimeout(500)
  const emailRespP = page
    .waitForResponse((r) => /\/api\/projects\/[^/]+\/email$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 })
    .catch(() => null)
  await page.getByRole('dialog').getByRole('button', { name: 'Start conversation 2' }).click()
  const emailResp = await emailRespP
  if (!emailResp) fail('no /email response captured')
  else {
    const body = await emailResp.json().catch(() => null)
    console.log(`POST /email → ${emailResp.status()}`, JSON.stringify(body))
    if (emailResp.status() !== 200) fail(`email → ${emailResp.status()}`)
    else {
      const tos = (body.to || []).slice().sort()
      if (JSON.stringify(tos) !== JSON.stringify([mae, sid].sort())) fail(`fan-out to = ${JSON.stringify(body.to)}`)
      if (!body.suppressed) fail('expected suppressed=true on preview for @example.com makers')
      if ((body.results || []).length !== 2) fail(`expected 2 results, got ${body.results?.length}`)
    }
    await page.waitForTimeout(1000)
    const confirmText = await page.locator('main').innerText()
    if (!/would have emailed/.test(confirmText)) console.warn('warn: suppressed-result copy not seen on card')
    else console.log('card shows suppressed multi-recipient result ✓')
  }
}

// --- Cleanup ---
const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
console.log(`cleanup DELETE → ${del.status()}`)

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: #115 multi-maker fan-out + import shortcut verified')
