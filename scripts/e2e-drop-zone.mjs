#!/usr/bin/env node
// Verify the maker-chat drop target covers the whole chat panel, not just the
// composer row: a synthetic file drag over the MESSAGE LIST must light the
// highlight ring, and dropping there must stage the file as a pending
// attachment. Creates a brief, drives as its maker, deletes.
// Usage: node scripts/e2e-drop-zone.mjs

import { launchLoggedIn, readToken, BASE, shotDir } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const EMAIL = `e2e-drop-${stamp}@example.com`
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn()

const reqP = page.waitForRequest((r) => r.url().includes('/api/projects'), { timeout: 15000 })
await page.reload({ waitUntil: 'domcontentloaded' })
const auth = (await reqP).headers()['authorization']

const create = await page.request.post(`${BASE}/api/projects`, {
  headers: { authorization: auth, 'content-type': 'application/json' },
  data: JSON.stringify({
    title: `E2E drop zone ${stamp} — delete me`,
    requester_email: EMAIL,
    requester_first_name: 'Mara',
    welcome_message: 'Hey Mara — drop a file anywhere on this chat.',
  }),
})
if (create.status() !== 201) { console.error(`FAIL: create → ${create.status()}`); process.exit(1) }
const proj = await create.json()
const passcode = (proj.members || []).find((m) => m.email === EMAIL)?.passcode

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
// First-visit display-name gate renders after the project loads — poll for
// either the gate (fill it) or the welcome bubble (ready).
const bubble = mpage.getByText('drop a file anywhere on this chat')
for (let i = 0; i < 20; i++) {
  if (await bubble.count()) break
  if ((await mpage.locator('body').innerText()).includes('What should we call you?')) {
    await mpage.locator('input:visible').first().fill('Mara')
    await mpage.getByRole('button', { name: 'Continue' }).click()
  }
  await mpage.waitForTimeout(1000)
}
try {
  await bubble.waitFor({ timeout: 15000 })
} catch {
  await mpage.screenshot({ path: `${shotDir}/drop-zone-debug.png`, fullPage: true })
  console.error('DEBUG url:', mpage.url())
  console.error('DEBUG body head:', (await mpage.locator('body').innerText()).slice(0, 800))
  fail('welcome bubble not visible — see drop-zone-debug.png')
  await mctx.close()
  await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, { headers: { authorization: auth } })
  await browser.close()
  process.exit(1)
}

const dragOverBubble = (type) =>
  bubble.evaluate((el, evType) => {
    const dt = new DataTransfer()
    dt.items.add(new File(['drop-zone e2e'], 'dropped-note.txt', { type: 'text/plain' }))
    el.dispatchEvent(new DragEvent(evType, { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, type)

await dragOverBubble('dragover')
await mpage.waitForTimeout(300)
const ringCount = await mpage.locator('.ring-2').count()
if (!ringCount) fail('dragover over the message list did not light the highlight ring')
else ok('dragover over the message list lights the highlight ring')
await mpage.screenshot({ path: `${shotDir}/drop-zone-ring.png`, fullPage: true })

await dragOverBubble('drop')
await mpage.waitForTimeout(500)
const body = await mpage.locator('body').innerText()
if (!body.includes('dropped-note.txt')) fail('drop over the message list did not stage the file')
else ok('drop over the message list stages the file as a pending attachment')
if (await mpage.locator('.ring-2').count()) fail('highlight ring did not clear after drop')
else ok('highlight ring clears after drop')
await mpage.screenshot({ path: `${shotDir}/drop-zone-staged.png`, fullPage: true })

await mctx.close()
const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, {
  headers: { authorization: auth },
})
console.log(`cleanup DELETE → ${del.status()}`)
await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: whole-panel drop zone verified')
