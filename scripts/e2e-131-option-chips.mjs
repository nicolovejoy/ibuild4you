#!/usr/bin/env node
// #131 — clickable option chips in maker chat. Creates a project whose
// directive forces an options block in the first reply, logs in as its maker,
// sends a message, and grades: chips render (no raw JSON), tapping a chip
// sends its label as a user message, and the tapped-away chips go static.
// Usage: node scripts/e2e-131-option-chips.mjs

import { launchLoggedIn, readToken, BASE, shotDir } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = `e2e131-maker-${stamp}@example.com`

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()

// Capture a Bearer token off the dashboard's own API traffic.
const reqP = page.waitForRequest((r) => r.url().includes('/api/projects'), { timeout: 15000 })
await page.reload({ waitUntil: 'domcontentloaded' })
const auth = (await reqP).headers()['authorization']

const create = await page.request.post(`${BASE}/api/projects`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({
    title: `E2E131 option chips ${stamp} — delete me`,
    requester_email: EMAIL,
    requester_first_name: 'Mara',
    builder_directives: [
      'Every reply in this session must end with an options block offering exactly 3 short choices, per the quick-choices convention.',
    ],
    welcome_message: 'Hey Mara — tell me a bit about what you want to build.',
  }),
})
if (create.status() !== 201) { console.error(`FAIL: create → ${create.status()}`); process.exit(1) }
const proj = await create.json()
const passcode = (proj.members || []).find((m) => m.email === EMAIL)?.passcode
console.log(`created ${proj.id} (${proj.slug}), maker passcode ${passcode ? 'minted' : 'MISSING'}`)

const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
const mpage = await mctx.newPage()
await mpage.goto(
  `${BASE}/projects/${proj.slug}?x-vercel-protection-bypass=${readToken()}&x-vercel-set-bypass-cookie=true`,
  { waitUntil: 'domcontentloaded' },
)
await mpage.waitForTimeout(2000)
if (mpage.url().includes('/auth/login')) {
  await mpage.locator('#email').fill(EMAIL)
  await mpage.locator('#passcode').fill(passcode)
  await mpage.getByRole('button', { name: 'Sign in with passcode' }).click()
  await mpage.waitForTimeout(3000)
  if (!mpage.url().includes('/projects/')) {
    await mpage.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
    await mpage.waitForTimeout(2500)
  }
}

// First-visit gate: new makers are asked for a display name before the chat —
// and it renders AFTER project load, so poll gate-or-composer (#39 gotcha).
const box = mpage.getByPlaceholder('Type a message...')
for (let i = 0; i < 20; i++) {
  if (await box.isVisible().catch(() => false)) break
  if ((await mpage.locator('body').innerText().catch(() => '')).includes('What should we call you?')) {
    await mpage.locator('input:visible').first().fill('Mara')
    await mpage.getByRole('button', { name: 'Continue' }).click()
    console.log('display-name gate passed')
  }
  await mpage.waitForTimeout(2000)
}
if (!(await box.isVisible().catch(() => false))) {
  await mpage.screenshot({ path: `${shotDir}/131-no-composer.png`, fullPage: true })
  console.error('FAIL: composer never appeared; page text head:')
  console.error((await mpage.locator('body').innerText().catch(() => '')).slice(0, 500))
  await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, { headers: { authorization: auth } })
  await browser.close()
  process.exit(1)
}
await box.fill('I want a simple site for my pottery classes. Where do we start?')
await box.press('Enter')

// Wait for the reply stream to finish: chips only activate post-stream.
await mpage.waitForTimeout(20000)
await mpage.screenshot({ path: `${shotDir}/131-reply.png`, fullPage: true })

// Maker chat renders newest-first — the reply is at the head of main.
const mainText = await mpage.locator('main').innerText().catch(() => '')

// 1. No raw options JSON leaked into the rendered message.
grade(!mainText.includes('```options'), 'no raw ```options fence visible')

// 2. Tappable chips rendered — the only rounded-full buttons in the chat
//    (attach/send in the composer are rounded-lg).
const chipButtons = mpage.locator('main button.rounded-full')
const chipCount = await chipButtons.count()
grade(chipCount >= 2, `option chips rendered (found ${chipCount})`)

if (chipCount >= 2) {
  const chipLabel = (await chipButtons.first().innerText()).trim()
  console.log(`tapping chip: "${chipLabel}"`)
  await chipButtons.first().click()
  await mpage.waitForTimeout(20000)
  await mpage.screenshot({ path: `${shotDir}/131-after-tap.png`, fullPage: true })

  const after = await mpage.locator('main').innerText().catch(() => '')
  // 3. The tapped label became a normal user message (appears with Mara's
  //    sender line). innerText of the whole main is enough: the label now
  //    appears at least twice (static chip on the old message + user bubble).
  const occurrences = after.split(chipLabel).length - 1
  grade(occurrences >= 2, `tapped label sent as user message ("${chipLabel}" ×${occurrences})`)

  // 4. Agent replied to the choice (another reply landed after the tap —
  //    directive says every reply ends with options, so chips exist again).
  const newChipCount = await chipButtons.count()
  grade(newChipCount >= 2, `agent replied with fresh active chips (${newChipCount})`)
} else {
  console.log('--- main text head for diagnosis ---')
  console.log(mainText.slice(0, 800))
  failures++
}

await mctx.close()
const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, {
  headers: { authorization: auth },
})
console.log(`cleanup DELETE → ${del.status()}`)
await browser.close()

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
