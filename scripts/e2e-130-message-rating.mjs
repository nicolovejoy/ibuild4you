#!/usr/bin/env node
// #130 — thumbs up/down on agent responses. Creates a project, chats as its
// maker, rates the agent's reply 👍, and grades: the rating persists on the
// message doc, survives reload, shows in the builder transcript, and tapping
// the active thumb clears it.
// Usage: node scripts/e2e-130-message-rating.mjs

import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, shotDir } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
// Maker = a seeded cast identity with a password (PR D retired passcodes, so
// an ad-hoc email can no longer sign in off the create response).
const EMAIL = 'test-originator@ibuild4you.com'

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
    title: `E2E130 message rating ${stamp} — delete me`,
    requester_email: EMAIL,
    requester_first_name: 'Mara',
    welcome_message: 'Hey Mara — tell me a bit about what you want to build.',
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

// First-visit gate renders AFTER project load — poll gate-or-composer (#39 gotcha).
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
  console.error('FAIL: composer never appeared')
  await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, { headers: { authorization: auth } })
  await browser.close()
  process.exit(1)
}

await box.fill('I want a booking page for my dog-walking service.')
await box.press('Enter')
// Wait out the stream + the post-stream refetch that attaches message ids.
await mpage.waitForTimeout(22000)

// 1. Thumb buttons render on the agent reply (newest-first: first thumbs pair
//    in main belongs to the newest agent message).
const upThumb = mpage.locator('main button[title="Helpful"]').first()
grade(await upThumb.isVisible().catch(() => false), 'thumb buttons visible on agent reply')
await mpage.screenshot({ path: `${shotDir}/130-before-rate.png`, fullPage: true })

// 2. Tap 👍 → persisted on the message doc.
await upThumb.click()
await mpage.waitForTimeout(2500)
const sessionsRes = await page.request.get(`${BASE}/api/sessions?project_id=${proj.id}`, {
  headers: { authorization: auth },
})
const sessions = await sessionsRes.json()
const sessionId = (Array.isArray(sessions) ? sessions : []).find((s) => s.status === 'active')?.id
const fetchRated = async () => {
  const res = await page.request.get(`${BASE}/api/messages?session_id=${sessionId}`, {
    headers: { authorization: auth },
  })
  const msgs = await res.json()
  return (Array.isArray(msgs) ? msgs : []).filter((m) => m.rating)
}
let rated = sessionId ? await fetchRated() : []
grade(rated.length === 1 && rated[0].rating === 'up' && rated[0].role === 'agent',
  `rating persisted on the agent message (${JSON.stringify(rated.map((m) => m.rating))})`)

// 3. Survives reload (rendered from the doc, not local state).
await mpage.reload({ waitUntil: 'domcontentloaded' })
await mpage.waitForTimeout(4000)
const upAfterReload = mpage.locator('main button[title="Remove rating"]').first()
grade(await upAfterReload.isVisible().catch(() => false), 'active 👍 survives reload')
await mpage.screenshot({ path: `${shotDir}/130-after-reload.png`, fullPage: true })

// 4. Builder transcript shows the rating suffix (admin/owner view).
await page.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const builderText = await page.locator('main').innerText().catch(() => '')
grade(builderText.includes('👍'), 'builder transcript shows 👍 suffix')
await page.screenshot({ path: `${shotDir}/130-builder-view.png`, fullPage: true })

// 5. Tapping the active thumb clears the rating.
await upAfterReload.click()
await mpage.waitForTimeout(2500)
rated = sessionId ? await fetchRated() : []
grade(rated.length === 0, 'tapping active thumb clears the rating')

await mctx.close()
const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, {
  headers: { authorization: auth },
})
console.log(`cleanup DELETE → ${del.status()}`)
await browser.close()

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
