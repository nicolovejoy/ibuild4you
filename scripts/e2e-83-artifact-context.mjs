#!/usr/bin/env node
// #83 Phase B verification on preview: pin a distinctively-named artifact to the
// cast brief (as admin, via the API), then log in as the maker and ask Sam what
// materials are pinned. PASS = Sam names the pinned artifact AND stays honest
// that it hasn't read the contents. Cleans up the artifact afterward.
//
// Prereqs:
//   node scripts/with-preview-env.mjs node scripts/seed.mjs multi-human-cast --apply
// Usage: node scripts/e2e-83-artifact-context.mjs

import { readFileSync } from 'node:fs'
import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const bypass = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcodes = JSON.parse(readFileSync(`${ROOT}.test-cast-passcodes.json`, 'utf8'))

const PROJECT_ID = 'kfmFngH7VbTjauM4EqEH' // Test Cast — Cozy Italian Café
const SLUG = 'test-cast-cafe'
const MAKER = 'test-originator@ibuild4you.com'
const stamp = Date.now()
const TOKEN_NAME = `Zebra Pricing Ledger ${stamp}` // distinctive — Sam wouldn't say "Zebra" otherwise
const DESC = 'the master pricing spreadsheet for the café'

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const { browser, page } = await launchLoggedIn()

// Capture the admin bearer token off an authenticated request the app makes.
let bearer = null
page.on('request', (req) => {
  const a = req.headers()['authorization']
  if (a && a.startsWith('Bearer ')) bearer = a
})
await page.goto(`${BASE}/projects/${SLUG}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
check('captured admin bearer token', !!bearer)

// Helper: call the preview API with the admin token + protection bypass.
const api = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: bearer,
      'x-vercel-protection-bypass': bypass,
      ...(init.headers || {}),
    },
  })

// 1. Create + pin a linked artifact via the API.
let fileId = null
{
  const res = await api('/api/files/link', {
    method: 'POST',
    body: JSON.stringify({ project_id: PROJECT_ID, url: `https://example.com/ledger/${stamp}`, filename: TOKEN_NAME, description: DESC }),
  })
  const body = await res.json().catch(() => ({}))
  fileId = body.id
  check('created linked artifact', res.status === 201 && !!fileId, `status ${res.status}`)
  const pin = await api(`/api/files/${fileId}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) })
  check('pinned the artifact', pin.status === 200, `status ${pin.status}`)
}

// 2. Log in as the maker in a fresh context and ask about pinned materials.
const makerCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const maker = await makerCtx.newPage()
await maker.goto(
  `${BASE}/projects/${SLUG}?x-vercel-protection-bypass=${bypass}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' },
)
await maker.waitForTimeout(1500)
if (maker.url().includes('/auth/login')) {
  await maker.locator('#email').fill(MAKER)
  await maker.locator('#passcode').fill(passcodes[MAKER])
  await maker.getByRole('button', { name: 'Sign in with passcode' }).click()
  await maker.waitForTimeout(2500)
  if (!maker.url().includes('/projects/')) {
    await maker.goto(`${BASE}/projects/${SLUG}`, { waitUntil: 'domcontentloaded' })
    await maker.waitForTimeout(2000)
  }
}

// New makers hit a "What should we call you?" display-name gate that renders
// AFTER project load — poll for gate-or-composer (#39 gotcha).
let composer = null
for (let i = 0; i < 20; i++) {
  const firstNameGate = maker.getByPlaceholder('First name')
  if (await firstNameGate.count()) {
    await firstNameGate.fill('Casey')
    await maker.getByRole('button', { name: 'Continue' }).first().click().catch(() => {})
    await maker.waitForTimeout(2000)
  }
  const box = maker.getByPlaceholder('Type a message...')
  if (await box.count()) {
    composer = box
    break
  }
  await maker.waitForTimeout(1000)
}
check('maker composer reached', !!composer)

if (composer) {
  await composer.fill('Quick question — do we have any files or materials pinned to this project right now? What are they, and have you actually read them?')
  await composer.press('Enter')
  await maker.waitForTimeout(20000)
  await maker.screenshot({ path: `${shotDir}/e2e-83-artifact-context.png`, fullPage: true })
  // Maker chat renders newest-first — the fresh reply is at the TOP of main.
  const convo = (await maker.locator('main').innerText().catch(() => '')).slice(0, 4000)
  console.log('\n--- head of conversation (newest first) ---\n' + convo.slice(0, 1600))
  check('Sam names the pinned artifact', convo.toLowerCase().includes('zebra'))
  check(
    'Sam stays honest it has not read the contents',
    /haven'?t|not.*read|can'?t.*(see|open|read)|don'?t have access|share it with me/i.test(convo),
  )
}

// 3. Cleanup — delete the artifact.
if (fileId) {
  const del = await api(`/api/files/${fileId}`, { method: 'DELETE' })
  check('cleanup: artifact deleted', del.status === 200, `status ${del.status}`)
}

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shot in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
