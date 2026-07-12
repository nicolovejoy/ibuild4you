#!/usr/bin/env node
// Verify the paste-to-dispatch return leg on preview:
//  1. Fresh brief (maker hasn't replied → dispatch state 'nudge'): pasting a
//     payload lands on Conversations WITHOUT the Start modal, showing the
//     dismissible "Payload loaded." line; dismiss clears it.
//  2. After a synthetic maker reply (dispatch state 'start'): pasting a multi
//     payload lands on Conversations WITH the Start modal auto-opened and a
//     "Payload loaded — brief + agent config updated." line inside; closing
//     the modal consumes the one-shot (no leftover line).
// Creates a brief via Import JSON, drives, deletes.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const payload = {
  _payload_type: 'new-project',
  title: `Paste-dispatch e2e ${stamp}`,
  requester_email: `paste-dispatch-${stamp}@example.com`,
  requester_first_name: 'Mara',
  brief: {
    problem: 'Customers cannot order online.',
    target_users: 'Local cafe customers.',
    features: ['Online ordering'],
  },
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// --- Setup: create the brief via the dashboard Import-JSON modal ---
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

const pasteOnBriefTab = async (json) => {
  await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByPlaceholder(/next-convo/).fill(JSON.stringify(json))
  await page.getByRole('button', { name: 'Import JSON' }).click()
  await page.waitForTimeout(2500)
}

// --- 1. Nudge state: paste → confirmation line, no modal ---
await pasteOnBriefTab({ _payload_type: 'next-convo', brief: { ...payload.brief, problem: `Nudge-state paste ${stamp}` } })
if (page.url().includes('tab=brief')) fail(`import didn't hand off to Conversations: ${page.url()}`)
else ok('import hands off to Conversations')

if (await page.getByRole('dialog').count()) fail('Start modal opened while dispatch state is nudge')
else ok('no modal in nudge state')

const stripText = () => page.locator('main').innerText().then((t) => t.replace(/\s+/g, ' '))
if (!(await stripText()).includes('Payload loaded.')) fail('loaded-confirmation line missing in nudge state')
else ok('loaded-confirmation line shows')

await page.getByRole('button', { name: 'Dismiss' }).click()
await page.waitForTimeout(400)
if ((await stripText()).includes('Payload loaded.')) fail('dismiss did not clear the confirmation line')
else ok('dismiss clears the line')

// --- 2. Flip to start state: synthetic maker reply in the active session ---
const sessionsResp = await page.request.get(`${BASE}/api/sessions?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
const sessions = await sessionsResp.json()
const active = sessions.find((s) => s.status === 'active')
if (!active) { fail('no active session to reply into'); await browser.close(); process.exit() }
const synth = await page.request.post(`${BASE}/api/admin/sessions`, {
  headers: { authorization: authHeader, 'content-type': 'application/json' },
  data: JSON.stringify({
    project_id: brief.id,
    op: 'add_synthetic_message',
    session_id: active.id,
    role: 'user',
    content: 'Synthetic maker reply (e2e paste-to-dispatch).',
  }),
})
if (synth.status() !== 200) { fail(`add_synthetic_message → ${synth.status()}`); await browser.close(); process.exit() }
ok('synthetic maker reply added (dispatch → start)')

// --- 3. Start state: multi paste → modal auto-opens with the loaded line ---
await pasteOnBriefTab({
  _payload_type: 'next-convo',
  brief: { ...payload.brief, problem: `Start-state paste ${stamp}` },
  session_mode: 'converge',
})
const dialog = page.getByRole('dialog')
if (!(await dialog.count())) fail('Start modal did not auto-open after paste in start state')
else {
  ok('Start modal auto-opened')
  const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ')
  if (!/Start conversation 2/.test(dialogText)) fail(`modal isn't the Start dispatch: "${dialogText.slice(0, 120)}"`)
  else ok('modal is Start conversation 2')
  if (!dialogText.includes('Payload loaded — brief + agent config updated.'))
    fail('loaded line (brief + agent config) missing from the modal')
  else ok('loaded line shows inside the modal')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  if (await page.getByRole('dialog').count()) fail('Escape did not close the modal')
  else if ((await stripText()).includes('Payload loaded.')) fail('one-shot not consumed on modal close')
  else ok('modal closes and consumes the one-shot')
}

// --- Cleanup ---
const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
console.log(`cleanup DELETE → ${del.status()}`)

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: paste-to-dispatch return leg verified')
