// Smoke for PR #221 on preview: import warning (#216) + copy prep title (#215).
// Usage: node scripts/e2e-221-import-warning-prep-title.mjs
// Needs .ibuild4you-bypass + .test-admin-password (see scripts/lib/preview-login.mjs).
// Opens the first dashboard brief, imports a next-convo payload with directives under
// discover, expects the warning + Continue hand-off, then copies the prep and checks
// the Title line. Mutates that test brief (problem text + session_mode).
import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'

const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// Capture clipboard writes before any page script runs.
await page.addInitScript(() => {
  window.__clip = []
  const stub = { writeText: async (t) => { window.__clip.push(t) } }
  Object.defineProperty(navigator, 'clipboard', { value: stub, configurable: true })
})

// Open the first brief from the dashboard.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
const card = page.locator('div.cursor-pointer:has(h3)').first()
await card.waitFor({ timeout: 15000 })
const briefTitle = (await card.locator('h3').first().textContent())?.trim()
await card.click()
await page.waitForURL(/\/projects\//, { timeout: 15000 })
await page.waitForTimeout(1500)
console.log('brief:', briefTitle, page.url())

// Brief tab.
const briefTab = page.getByRole('button', { name: /^Brief$/ }).or(page.getByRole('tab', { name: /^Brief$/ })).or(page.getByText(/^Brief$/)).first()
if (await briefTab.count()) await briefTab.click()
await page.waitForTimeout(800)

// --- #216: import a payload whose directives are ignored in discover mode ---
const payload = JSON.stringify({ _payload_type: 'next-convo', brief: { problem: 'smoke #221' }, session_mode: 'discover', builder_directives: ['smoke directive'] })
const textarea = page.locator('textarea[placeholder*="next-convo"]')
await textarea.waitFor({ timeout: 10000 })
await textarea.fill(payload)
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${shotDir}/smoke-221-after-import.png` })

const warning = page.getByText(/builder directives.*discover mode/i)
ok('warning shown for directives under discover', (await warning.count()) > 0)
ok('still on Brief tab (textarea visible)', await textarea.isVisible())
const cont = page.getByRole('button', { name: 'Continue to Conversations' })
ok('Continue to Conversations button present', (await cont.count()) > 0)
if (await cont.count()) {
  await cont.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${shotDir}/smoke-221-after-continue.png` })
  const banner = page.getByText(/Payload loaded/i)
  const modal = page.getByRole('dialog')
  const handedOff = (await banner.count()) > 0 || (await modal.count()) > 0
  ok('Conversations hand-off (banner or Start modal)', handedOff, `banner=${await banner.count()} dialog=${await modal.count()}`)
  if (await modal.count()) await page.keyboard.press('Escape')
}

// --- #215: hard reload, copy prep, read captured clipboard ---
await page.goto(page.url().split('?')[0], { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const briefTab2 = page.getByText(/^Brief$/).first()
if (await briefTab2.count()) await briefTab2.click()
const copyBtn = page.getByRole('button', { name: /Copy next-convo prep/i })
await copyBtn.waitFor({ timeout: 10000 })
// Wait until enabled (project loaded), then click.
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Copy next-convo prep/i.test(x.textContent || ''))
  return b && !b.disabled
}, null, { timeout: 10000 })
await copyBtn.click()
await page.waitForTimeout(4000)
const clip = await page.evaluate(() => window.__clip)
const text = clip?.[clip.length - 1] || ''
const m = text.match(/^Title: (.*)$/m)
ok('prep copied', !!text, `${text.length} chars`)
ok('prep Title line is the real title', !!m && m[1].trim() !== 'Untitled' && m[1].trim() === briefTitle, `got "${m?.[1]}" expected "${briefTitle}"`)

await browser.close()
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
