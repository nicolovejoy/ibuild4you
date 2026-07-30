#!/usr/bin/env node
// Verify #110 on preview — a builder/admin can explicitly join the maker chat:
//  1. Builder view shows "Join the conversation" on the status strip (no composer).
//  2. Clicking it lands on ?view=chat: participant banner + a live composer.
//  3. No kickoff request fires for a builder-side opener.
//  4. Sending a message works, but does NOT stamp last_maker_message_at
//     (builder-side messages must not silence maker reminders).
//  5. "Back to builder view" returns to the read-only builder view, and the
//     transcript shows the builder's message.
// Creates a 1-maker brief via the Import-JSON modal, drives it, deletes it.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const mae = `e2e-mae-${stamp}@example.com`
const WELCOME = 'Hey Mae — tell me about the idea!'
const BUILDER_MSG = 'Hello from your builder, checking in. (e2e synthetic)'
const payload = {
  _payload_type: 'new-project',
  title: `Dual-role e2e ${stamp}`,
  participants: [{ email: mae, first_name: 'Mae', role: 'maker' }],
  welcome_message: WELCOME,
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// Track kickoff calls — a builder-side opener must never fire one.
let kickoffCalls = 0
page.on('request', (r) => { if (r.url().includes('/api/chat/kickoff')) kickoffCalls++ })

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

// --- 2. Builder view: Join link present, no composer ---
// Poll a few reloads: the preview deploy may still be rolling when we start.
// The import modal auto-navigates to the new brief right after create — give
// that redirect a beat so our own goto doesn't get aborted by it.
await page.waitForTimeout(3000)
let joinSeen = false
for (let i = 0; i < 8; i++) {
  await page.goto(`${BASE}/projects/${brief.slug}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(3000)
  if (await page.getByRole('button', { name: 'Join the conversation' }).count()) { joinSeen = true; break }
  console.log(`join link not there yet (attempt ${i + 1}) — deploy may still be building`)
  await page.waitForTimeout(20000)
}
if (!joinSeen) { fail('"Join the conversation" never appeared on the builder status strip'); await browser.close(); process.exit() }
ok('builder view shows "Join the conversation"')

const buildersComposers = await page.locator('main textarea:not([readonly])').count()
if (buildersComposers > 0) fail('builder view has an editable composer — should be read-only')
else ok('builder view stays read-only')

// --- 3. Join → participant chat ---
await page.getByRole('button', { name: 'Join the conversation' }).click()
await page.waitForTimeout(3000)
if (!page.url().includes('view=chat')) fail(`URL missing view=chat: ${page.url()}`)
else ok('navigated to ?view=chat')

const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
if (!/You’ve joined this conversation|You've joined this conversation/.test(bodyText)) {
  fail('participant banner missing')
} else ok('participant banner shown')

const composer = page.locator('textarea').first()
if (!(await composer.count())) { fail('no composer in participant chat'); await browser.close(); process.exit() }
ok('composer available in participant chat')

if (kickoffCalls > 0) fail(`kickoff fired ${kickoffCalls}× for a builder-side opener`)
else ok('no kickoff request for a builder-side opener')

// --- 4. Send a message; verify it lands but stamps no maker activity ---
await composer.fill(BUILDER_MSG)
const chatRespP = page
  .waitForResponse((r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST', { timeout: 20000 })
  .catch(() => null)
await composer.press('Enter')
const chatResp = await chatRespP
if (!chatResp || chatResp.status() !== 200) fail(`POST /api/chat → ${chatResp?.status()}`)
else ok('builder message accepted by /api/chat')

// Let the stream finish before we poke the API.
await page.waitForTimeout(12000)

const projResp = await page.request.get(`${BASE}/api/projects?slug=${brief.slug}`, {
  headers: { authorization: authHeader },
})
const proj = await projResp.json()
if (proj.last_maker_message_at) fail(`last_maker_message_at stamped by a builder message: ${proj.last_maker_message_at}`)
else ok('last_maker_message_at untouched by the builder message')

// --- 5. Back to builder view; transcript shows the message ---
await page.getByRole('button', { name: 'Back to builder view' }).click()
await page.waitForTimeout(3000)
if (page.url().includes('view=chat')) fail('still on ?view=chat after "Back to builder view"')
else ok('back on the builder view')

const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
if (!mainText.includes(BUILDER_MSG)) fail('builder transcript missing the participant message')
else ok('builder transcript shows the participant message')

const backComposers = await page.locator('main textarea:not([readonly])').count()
if (backComposers > 0) fail('builder view has a composer after returning')
else ok('builder view read-only after returning')

// --- Cleanup ---
const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
console.log(`cleanup DELETE → ${del.status()}`)

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: #110 dual-role participate verified')
