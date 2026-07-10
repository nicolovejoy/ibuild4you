#!/usr/bin/env node
// Verify #120 on preview — the builder Conversations tab is reader-first:
//  1. No composer: the builder view has no chat textarea.
//  2. Transcript is chronological (welcome BEFORE the maker's reply).
//  3. The live conversation is labeled "Conversation 1 · in progress".
//  4. The status strip names EVERY maker (not just the first requester).
//  5. Dispatch is state-aware: "Nudge …" while waiting, "Start conversation 2
//     & email …" once the maker replied.
//  6. Agent setup is off the Conversations screen; it lives on ?tab=setup.
// Creates a 2-maker brief via the Import-JSON modal, drives it, deletes it.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const mae = `e2e-mae-${stamp}@example.com`
const sid = `e2e-sid-${stamp}@example.com`
const WELCOME = 'Hey both — tell me about the idea!'
const REPLY = 'We want an app for our bakery. (e2e synthetic)'
const payload = {
  _payload_type: 'new-project',
  title: `Reader-first e2e ${stamp}`,
  participants: [
    { email: mae, first_name: 'Mae', role: 'maker' },
    { email: sid, first_name: 'Sid', role: 'maker' },
  ],
  welcome_message: WELCOME,
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

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

// --- 2. Waiting state: no composer, label, roster, Nudge dispatch ---
await page.goto(`${BASE}/projects/${brief.slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const composers = await page.locator('main textarea:not([readonly])').count()
if (composers > 0) fail(`builder view has ${composers} editable textarea(s) — composer should be gone`)
else ok('no composer in builder Conversations')

const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
if (!/Conversation 1 · in progress/i.test(mainText)) fail('missing "Conversation 1 · in progress" label')
else ok('live conversation labeled')

const maePrefix = mae.split('@')[0]
const sidPrefix = sid.split('@')[0]
if (!mainText.includes(maePrefix) || !mainText.includes(sidPrefix)) {
  fail('status strip does not name both makers')
} else ok('status strip names both makers')

if (/Agent setup/i.test(mainText)) fail('Agent setup still renders on the Conversations screen')
else ok('Agent setup off the Conversations screen')

const nudgeBtn = page.getByRole('button', { name: /^Nudge / })
if (!(await nudgeBtn.count())) fail('waiting state: "Nudge …" dispatch button not found')
else ok(`nudge dispatch: "${(await nudgeBtn.innerText()).replace(/\s+/g, ' ')}"`)

// --- 3. Maker replies (admin synthetic message, #105) ---
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
    content: REPLY,
  },
})
if (synth.status() !== 200) fail(`add_synthetic_message → ${synth.status()}`)

// --- 4. Replied state: chronological transcript + Start dispatch ---
await page.goto(`${BASE}/projects/${brief.slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const afterText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')

const wIdx = afterText.indexOf(WELCOME)
const rIdx = afterText.indexOf(REPLY)
if (wIdx < 0 || rIdx < 0) fail(`transcript missing messages (welcome@${wIdx}, reply@${rIdx})`)
else if (wIdx > rIdx) fail('transcript is not chronological — reply renders before the welcome')
else ok('transcript chronological (oldest → newest)')

const startBtn = page.getByRole('button', { name: /Start conversation 2 & email/ })
if (!(await startBtn.count())) fail('replied state: "Start conversation 2 & email …" dispatch not found')
else ok('dispatch flipped to start-next-round after maker reply')

// --- 5. Agent setup lives on its own tab ---
await page.goto(`${BASE}/projects/${brief.slug}?tab=setup`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const setupText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
if (!/Agent setup/i.test(setupText) || !/Save setup/i.test(setupText)) {
  fail('?tab=setup does not show the Agent setup editor')
} else ok('Agent setup lives on ?tab=setup')

// --- Cleanup ---
const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
console.log(`cleanup DELETE → ${del.status()}`)

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: #120 reader-first Conversations verified')
