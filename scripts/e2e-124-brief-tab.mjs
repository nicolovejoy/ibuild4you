#!/usr/bin/env node
// Verify the Brief-tab round (Nico 2026-07-11) on preview:
//  1. The next-convo paste target is first-class near the top of the Brief tab
//     (visible without opening any fold, ABOVE the brief content).
//  2. The brief renders collapsed (~4 lines) with "Show full brief" → expands.
//  3. The brief is not editable from the get-go — no form fields until "Edit
//     brief" is clicked (read-first BriefEditor).
//  4. Importing a brief-only JSON via the card works and hands off to
//     Conversations.
// Creates a brief with a long seeded brief via Import JSON, drives, deletes.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const LONG = 'Customers cannot order online and the cafe loses walk-in traffic on rainy days. '.repeat(6).trim()
const payload = {
  _payload_type: 'new-project',
  title: `Brief-tab e2e ${stamp}`,
  brief: {
    problem: LONG,
    target_users: 'Local cafe customers who want to order ahead.',
    features: ['Online ordering', 'Pickup scheduling', 'Loyalty punch card'],
    constraints: 'Must work on mobile. No app-store apps — web only.',
    additional_context: 'Owner is non-technical; keep everything self-serve.',
    decisions: [{ topic: 'Payments', decision: 'Stripe only', locked: true }],
  },
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// --- 1. Create the brief via the dashboard Import-JSON modal ---
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

// --- 2. Brief tab: paste card on top, collapsed brief, read-first editing ---
await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const pasteBox = page.getByPlaceholder(/next-convo/)
if (!(await pasteBox.isVisible().catch(() => false))) fail('paste card not visible without opening a fold')
else ok('paste target visible first-class')

// Headings render uppercase via CSS and innerText reflects text-transform —
// compare uppercased.
const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').toUpperCase()
const pasteIdx = mainText.indexOf('PASTE NEXT-CONVO PAYLOAD')
const problemIdx = mainText.indexOf('CUSTOMERS CANNOT ORDER ONLINE')
if (pasteIdx < 0 || problemIdx < 0) fail(`missing sections (paste@${pasteIdx}, problem@${problemIdx})`)
else if (pasteIdx > problemIdx) fail('paste card renders below the brief content')
else ok('paste card sits above the brief')

const showMore = page.getByRole('button', { name: 'Show full brief' })
if (!(await showMore.count())) fail('long brief is not collapsed (no "Show full brief")')
else {
  ok('brief collapsed with a more-option')
  await showMore.click()
  await page.waitForTimeout(300)
  if (!(await page.getByRole('button', { name: 'Show less' }).count())) fail('"Show less" missing after expand')
  else ok('expand/collapse toggles')
}

// Read-first: the only textarea on the tab is the paste box; brief fields
// appear only after "Edit brief".
const textareasBefore = await page.locator('main textarea').count()
if (textareasBefore !== 1) fail(`expected 1 textarea (paste box) before editing, saw ${textareasBefore}`)
else ok('brief not editable from the get-go')
await page.getByRole('button', { name: 'Edit brief' }).click()
await page.waitForTimeout(300)
if (!(await page.getByRole('button', { name: 'Save brief' }).count())) fail('"Edit brief" did not open the editor')
else ok('explicit edit mode opens')
// Leave edit mode so the import below starts from the read view.
await page.getByRole('button', { name: 'Cancel' }).click()
await page.waitForTimeout(300)

// --- 3. Import a brief-only JSON via the card → hands off to Conversations ---
const newProblem = `Updated problem via paste ${stamp}`
await pasteBox.fill(JSON.stringify({ ...payload.brief, problem: newProblem }))
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(2500)
if (page.url().includes('tab=brief')) fail(`import didn't hand off to Conversations: ${page.url()}`)
else ok('import hands off to Conversations')
await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const afterText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
if (!afterText.includes(newProblem)) fail('imported brief content not visible after reload')
else ok('imported content persisted')

// --- Cleanup ---
const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
console.log(`cleanup DELETE → ${del.status()}`)

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: Brief-tab collapse + first-class import verified')
