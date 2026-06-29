#!/usr/bin/env node
// Verify participants[]: importing a new-brief JSON with two participants
// creates a membership + passcode for each and returns them in members[].
// Drives the real Import-JSON modal so it exercises the deployed API end to
// end, captures the POST /api/projects response (and its Bearer header), then
// DELETEs the created brief so the preview env isn't left littered.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const EMAIL = 'test@ibuild4you.com'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()

// Unique-ish title without Date.now (keeps reruns from colliding via slug suffix).
const stamp = Math.floor(performance.now()).toString(36)
const payload = {
  _payload_type: 'new-project',
  title: `Participants e2e ${stamp}`,
  participants: [
    { email: `e2e-maker-${stamp}@example.com`, first_name: 'Mae', last_name: 'Ker', role: 'maker' },
    { email: `e2e-helper-${stamp}@example.com`, first_name: 'Hank', role: 'apprentice', brief_role: 'contributor' },
  ],
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {})
}
await page.waitForTimeout(1000)

// Open the New-brief modal → Import JSON tab.
await page.getByRole('button', { name: 'New brief' }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(300)
await page.locator('#project-json').fill(JSON.stringify(payload, null, 2))

// Submit and capture the create response.
const respP = page
  .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
  .catch(() => null)
await page.getByRole('button', { name: 'Import & create' }).click()
const resp = await respP

if (!resp) { fail('no POST /api/projects response captured'); await browser.close(); process.exit() }
const status = resp.status()
const body = await resp.json().catch(() => null)
const authHeader = resp.request().headers()['authorization']
console.log(`POST /api/projects → ${status}`)

if (status !== 201) { fail(`expected 201, got ${status}: ${JSON.stringify(body)}`); await browser.close(); process.exit() }

// --- Assertions ---
const members = body?.members || []
const byEmail = (e) => members.find((m) => m.email === e)
const makerEmail = payload.participants[0].email
const helperEmail = payload.participants[1].email

if (members.length !== 2) fail(`expected 2 members, got ${members.length}`)
const maker = byEmail(makerEmail)
const helper = byEmail(helperEmail)
if (!maker) fail(`maker membership missing for ${makerEmail}`)
else {
  if (maker.role !== 'maker') fail(`maker role = ${maker.role}`)
  if (maker.brief_role !== 'originator') fail(`maker brief_role = ${maker.brief_role}`)
  if (typeof maker.passcode !== 'string' || maker.passcode.length < 4) fail(`maker passcode bad: ${maker.passcode}`)
}
if (!helper) fail(`helper membership missing for ${helperEmail}`)
else {
  if (helper.role !== 'apprentice') fail(`helper role = ${helper.role}`)
  if (helper.brief_role !== 'contributor') fail(`helper brief_role = ${helper.brief_role}`)
  if (typeof helper.passcode !== 'string' || helper.passcode.length < 4) fail(`helper passcode bad: ${helper.passcode}`)
}
// Displayed requester = first maker participant.
if (body.requester_email !== makerEmail) fail(`requester_email = ${body.requester_email}, expected ${makerEmail}`)
if (body.requester_first_name !== 'Mae') fail(`requester_first_name = ${body.requester_first_name}`)

if (!process.exitCode) {
  console.log('PASS: 2 participants created, each with role/brief_role/passcode; requester stamped to first maker')
  console.log(`  maker:  ${maker.role}/${maker.brief_role} passcode=${maker.passcode}`)
  console.log(`  helper: ${helper.role}/${helper.brief_role} passcode=${helper.passcode}`)
}

// --- Cleanup: delete the created brief using the captured Bearer token. ---
const projectId = body.id
if (projectId && authHeader) {
  const del = await page.request.delete(`${BASE}/api/projects?project_id=${projectId}`, {
    headers: { authorization: authHeader },
  })
  console.log(`cleanup DELETE → ${del.status()}`)
} else {
  console.warn(`cleanup skipped (id=${projectId}, hasAuth=${!!authHeader}) — delete brief "${payload.title}" manually`)
}

await browser.close()
