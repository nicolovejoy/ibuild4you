#!/usr/bin/env node
// #142 verification on preview: seed a SIBLING brief that shares a github_repo
// with the cast brief and carries a distinctive locked decision, then log in as
// the cast maker and ask about that topic. PASS = Sam states the settled
// decision (surfaces the sibling's locked call) rather than asking about it.
// Cleans up the sibling + clears the cast repo afterward.
//
// Prereqs:
//   node scripts/with-preview-env.mjs node scripts/seed.mjs multi-human-cast --apply
// Usage: node scripts/e2e-142-sibling-decisions.mjs

import { readFileSync } from 'node:fs'
import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const bypass = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcodes = JSON.parse(readFileSync(`${ROOT}.test-cast-passcodes.json`, 'utf8'))

const PROJECT_B = 'kfmFngH7VbTjauM4EqEH' // Test Cast — Cozy Italian Café (the chat brief)
const SLUG_B = 'test-cast-cafe'
const MAKER = 'test-originator@ibuild4you.com'
const stamp = Date.now()
// Distinctive, owner/name form so both briefs land in the same family. Unique
// per run so leftover runs never collide.
const FAMILY = `e2e142/fam${stamp}`
// Distinctive wording — no PII, no UI keywords. "narwhal"/"Kelpie" are words Sam
// would never volunteer unless it read this locked decision.
const TOPIC = 'House mascot'
const DECISION = 'the house mascot is a narwhal named Kelpie'

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
await page.goto(`${BASE}/projects/${SLUG_B}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
check('captured admin bearer token', !!bearer)

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

// 1. Put the cast brief (B) into the family.
{
  const res = await api('/api/projects', {
    method: 'PATCH',
    body: JSON.stringify({ project_id: PROJECT_B, github_repo: FAMILY }),
  })
  check('cast brief joined the repo family', res.status === 200, `status ${res.status}`)
}

// 2. Create the sibling brief (A) with the locked decision, then join the family.
let siblingId = null
{
  const res = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      title: `Sibling Mascot Brief ${stamp}`,
      brief: { problem: 'sibling', decisions: [{ topic: TOPIC, decision: DECISION, locked: true }] },
    }),
  })
  const body = await res.json().catch(() => ({}))
  siblingId = body.id
  check('created sibling brief', !!siblingId, `status ${res.status}`)
  if (siblingId) {
    const patch = await api('/api/projects', {
      method: 'PATCH',
      body: JSON.stringify({ project_id: siblingId, github_repo: FAMILY }),
    })
    check('sibling joined the repo family', patch.status === 200, `status ${patch.status}`)
  }
}

// 3. Log in as the cast maker on B and ask about the mascot.
const makerCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const maker = await makerCtx.newPage()
await maker.goto(
  `${BASE}/projects/${SLUG_B}?x-vercel-protection-bypass=${bypass}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' },
)
await maker.waitForTimeout(1500)
if (maker.url().includes('/auth/login')) {
  await maker.locator('#email').fill(MAKER)
  await maker.locator('#passcode').fill(passcodes[MAKER])
  await maker.getByRole('button', { name: 'Sign in with passcode' }).click()
  await maker.waitForTimeout(2500)
  if (!maker.url().includes('/projects/')) {
    await maker.goto(`${BASE}/projects/${SLUG_B}`, { waitUntil: 'domcontentloaded' })
    await maker.waitForTimeout(2000)
  }
}

// Poll for the display-name gate OR composer (#39 gotcha).
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
  await composer.fill(
    "Quick check — have we already settled on what our house mascot is? What did we land on?",
  )
  await composer.press('Enter')
  await maker.waitForTimeout(20000)
  await maker.screenshot({ path: `${shotDir}/e2e-142-sibling-decisions.png`, fullPage: true })
  // Maker chat renders newest-first — the fresh reply is at the TOP of main.
  const convo = (await maker.locator('main').innerText().catch(() => '')).slice(0, 4000)
  console.log('\n--- head of conversation (newest first) ---\n' + convo.slice(0, 1600))
  check(
    'Sam surfaces the sibling brief locked decision (narwhal / Kelpie)',
    /narwhal|kelpie/i.test(convo),
  )
}

// 4. Cleanup — delete sibling, clear the cast brief's repo.
if (siblingId) {
  const del = await api(`/api/projects?project_id=${siblingId}`, { method: 'DELETE' })
  check('cleanup: sibling deleted', del.status === 200, `status ${del.status}`)
}
{
  const res = await api('/api/projects', {
    method: 'PATCH',
    body: JSON.stringify({ project_id: PROJECT_B, github_repo: '' }),
  })
  check('cleanup: cast brief repo cleared', res.status === 200, `status ${res.status}`)
}

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shot in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
