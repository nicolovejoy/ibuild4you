// Smoke for PR #261 on preview: the next-convo prep carries no provenance
// stamps, states how the size is counted, carries the welcome rule, and the
// Brief tab says so when a prep has no new notes.
// Usage: node scripts/e2e-261-prep-quick-batch.mjs
// Needs .ibuild4you-bypass + .test-admin-password (see scripts/lib/preview-login.mjs).
// Opens the first dashboard brief and copies its prep. The only write is the
// usual prep_copied_at stamp.
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

await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
const card = page.locator('div.cursor-pointer:has(h3)').first()
await card.waitFor({ timeout: 15000 })
await card.click()
await page.waitForURL(/\/projects\//, { timeout: 15000 })
await page.waitForTimeout(1500)

const briefTab = page.getByText(/^Brief$/).first()
if (await briefTab.count()) await briefTab.click()
const copyBtn = page.getByRole('button', { name: /Copy next-convo prep/i })
await copyBtn.waitFor({ timeout: 10000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Copy next-convo prep/i.test(x.textContent || ''))
  return b && !b.disabled
}, null, { timeout: 10000 })
await copyBtn.click()
await page.waitForTimeout(4000)
await page.screenshot({ path: `${shotDir}/smoke-261-after-copy.png` })

const clip = await page.evaluate(() => window.__clip)
const text = clip?.[clip.length - 1] || ''
ok('prep copied', !!text, `${text.length} chars`)

// Anchor on the tag with its version attribute: the rules above also mention
// "<current_brief>" in prose.
const briefBlock = text.match(/<current_brief version=[\s\S]*?<\/current_brief>/)?.[0] || ''
ok('brief block present', !!briefBlock)
ok('brief block carries no stamp field', !/decided_in_session|decided_at|revised_in_session|revised_at/.test(briefBlock))
ok('size line says spacing does not count', /Current size: [\d,]+ characters \(budget 20,000\)\. The size is counted without spacing and line breaks/.test(briefBlock))
ok('schema example has no stamp key', !/"decided_in_session"\s*:/.test(text))
ok('rule: do not write the stamps', /Do not write `decided_in_session`/.test(text))
ok('guide: leave the stamps out', /Leave out decided_in_session/.test(text))
ok('welcome rule present', /what is live now, what is proposed and not built/.test(text))

const noNotes = /<notes>\s*No new notes/.test(text)
const noticeText = /There are no new notes since the brief was last curated/i
if (!noNotes) ok('new notes present: no notice shown', (await page.getByText(noticeText).count()) === 0)

// The notice itself needs a brief with nothing unfolded. Try the next few
// dashboard briefs until one copies a prep with no notes.
let sawNotice = noNotes && (await page.getByText(noticeText).count()) > 0
for (let i = 1; i < 8 && !sawNotice; i++) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  const next = page.locator('div.cursor-pointer:has(h3)').nth(i)
  try { await next.waitFor({ timeout: 8000 }) } catch { break }
  await next.click()
  await page.waitForURL(/\/projects\//, { timeout: 15000 })
  const btn = page.getByRole('button', { name: /Copy next-convo prep/i })
  try { await btn.waitFor({ timeout: 10000 }) } catch { continue }
  await page.waitForTimeout(1500)
  if (await btn.isDisabled()) continue
  await btn.click()
  await page.waitForTimeout(4000)
  const clips = await page.evaluate(() => window.__clip)
  const prep = clips?.[clips.length - 1] || ''
  if (!/<notes>\s*No new notes/.test(prep)) continue
  sawNotice = (await page.getByText(noticeText).count()) > 0
  await page.screenshot({ path: `${shotDir}/smoke-261-no-new-notes.png` })
  ok('no new notes: the Brief tab says so', sawNotice, page.url())
  break
}
if (!sawNotice && !results.some((r) => r.name.startsWith('no new notes'))) {
  ok('no new notes: the Brief tab says so', false, 'no brief without unfolded notes among the first 8')
}

await browser.close()
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
