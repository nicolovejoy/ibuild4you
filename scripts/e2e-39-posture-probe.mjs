#!/usr/bin/env node
// #39 follow-up — standalone live posture probe. Creates a converge-mode
// project with a custom identity, logs in as its maker, sends one message,
// and grades whether the agent speaks as the custom identity.
// Usage: node scripts/e2e-39-posture-probe.mjs

import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, shotDir } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
// Maker = a seeded cast identity with a password (PR D retired passcodes, so
// an ad-hoc email can no longer sign in off the create response).
const EMAIL = 'test-originator@ibuild4you.com'
const IDENTITY =
  'You are Piper, a pragmatic intake assistant. Introduce yourself as Piper and end every reply with exactly one focused question.'

const { browser, page } = await launchLoggedIn()

// Capture a Bearer token off the dashboard's own API traffic.
const reqP = page.waitForRequest((r) => r.url().includes('/api/projects'), { timeout: 15000 })
await page.reload({ waitUntil: 'domcontentloaded' })
const auth = (await reqP).headers()['authorization']

const create = await page.request.post(`${BASE}/api/projects`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({
    title: `E2E39 posture probe ${stamp} — delete me`,
    requester_email: EMAIL,
    requester_first_name: 'Mara',
    session_mode: 'converge',
    identity: IDENTITY,
    welcome_message: 'Hey Mara — quick converge session today.',
  }),
})
if (create.status() !== 201) { console.error(`FAIL: create → ${create.status()}`); process.exit(1) }
const proj = await create.json()
console.log(`created ${proj.id} (${proj.slug})`)

const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const mpage = await mctx.newPage()
// Password sign-in as the cast maker (primes the bypass cookie itself).
await loginWithPassword(mpage, {
  email: EMAIL,
  password: readCastPassword(EMAIL),
  path: `/projects/${proj.slug}`,
})
console.log('after login:', mpage.url())
await mpage.screenshot({ path: `${shotDir}/39-probe-landing.png`, fullPage: true })

// First-visit gate: new makers are asked for a display name before the chat.
if ((await mpage.locator('body').innerText()).includes('What should we call you?')) {
  await mpage.locator('input:visible').first().fill('Mara')
  await mpage.getByRole('button', { name: 'Continue' }).click()
  await mpage.waitForTimeout(2500)
  console.log('display-name gate passed')
}

try {
  const box = mpage.getByPlaceholder('Type a message...')
  await box.waitFor({ timeout: 15000 })
  await box.fill('Quick check before we start: who am I talking to, and what are we doing today?')
  await box.press('Enter')
  await mpage.waitForTimeout(18000)
  await mpage.screenshot({ path: `${shotDir}/39-probe-reply.png`, fullPage: true })
  // Maker chat renders newest-first — reply is at the head of main.
  const head = (await mpage.locator('main').innerText().catch(() => '')).slice(0, 1500)
  console.log('--- reply head ---')
  console.log(head.slice(0, 600))
  console.log(/piper/i.test(head) ? 'PASS: agent speaks as Piper' : 'FAIL: no Piper in reply')
  if (!/piper/i.test(head)) process.exitCode = 1
} catch (e) {
  console.error('FAIL: composer not found —', e.message)
  const body = (await mpage.locator('body').innerText().catch(() => '')).slice(0, 500)
  console.log('page text head:', body)
  process.exitCode = 1
}

await mctx.close()
const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, {
  headers: { authorization: auth },
})
console.log(`cleanup DELETE → ${del.status()}`)
await browser.close()
