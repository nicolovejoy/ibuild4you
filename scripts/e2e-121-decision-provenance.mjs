#!/usr/bin/env node
// Verify decision provenance (#121) on preview without paying for a regen:
//  1. Create a brief via Import JSON with two decisions — one plain (create
//     path stamps it "added <today>") and one carrying EXPLICIT provenance
//     (honored verbatim).
//  2. Brief tab shows the quiet suffixes ("added Jul 1" etc.).
//  3. Paste a brief-only payload whose decisions DROPPED their stamps and add
//     one NEW decision → carry-forward restores the old stamps (explicit one
//     still reads its original date, not today); the new decision is stamped
//     out-of-band today.
// Exercises schema, PUT stamping, carry-forward, and display. Cleans up after.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const EXPLICIT_AT = '2026-07-01T00:00:00Z'
const briefFields = {
  problem: 'Customers cannot order online.',
  target_users: 'Local cafe customers.',
  features: ['Online ordering'],
  constraints: 'Web only.',
  additional_context: '',
}
const payload = {
  _payload_type: 'new-project',
  title: `Provenance e2e ${stamp}`,
  brief: {
    ...briefFields,
    decisions: [
      { topic: 'Payments', decision: 'Stripe only', locked: true },
      { topic: 'Auth', decision: 'Google', decided_in_session: null, decided_at: EXPLICIT_AT },
    ],
  },
}

const shortDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const TODAY_SHORT = shortDate(new Date().toISOString())

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// --- 1. Create via the dashboard Import-JSON modal ---
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

const getDecisions = async () => {
  const r = await page.request.get(`${BASE}/api/briefs?project_id=${brief.id}`, {
    headers: { authorization: authHeader },
  })
  const b = await r.json()
  return b?.content?.decisions || []
}

// --- 2. Create-path stamps ---
let decisions = await getDecisions()
const payments = decisions.find((d) => d.topic === 'Payments')
const auth = decisions.find((d) => d.topic === 'Auth')
if (!payments?.decided_at || payments.decided_in_session !== null)
  fail(`Payments not stamped out-of-band on create: ${JSON.stringify(payments)}`)
else ok('create path stamps a plain seeded decision')
if (auth?.decided_at !== EXPLICIT_AT)
  fail(`explicit provenance not honored on create: ${JSON.stringify(auth)}`)
else ok('explicit provenance honored on create')

// --- 3. Suffixes render in the Brief tab read view ---
await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
let mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
if (!mainText.includes(`added ${shortDate(EXPLICIT_AT)}`))
  fail(`suffix "added ${shortDate(EXPLICIT_AT)}" not rendered`)
else ok(`suffix renders for explicit stamp (added ${shortDate(EXPLICIT_AT)})`)
if (!mainText.includes(`added ${TODAY_SHORT}`))
  fail(`suffix "added ${TODAY_SHORT}" not rendered for the create-stamped decision`)
else ok(`suffix renders for create stamp (added ${TODAY_SHORT})`)

// --- 4. Paste with dropped stamps + one new decision ---
const pasteBox = page.getByPlaceholder(/next-convo/)
await pasteBox.fill(
  JSON.stringify({
    ...briefFields,
    decisions: [
      { topic: 'Payments', decision: 'Stripe only', locked: true }, // stamps dropped
      { topic: 'Auth', decision: 'Google' }, // stamps dropped
      { topic: 'Hosting', decision: 'Vercel' }, // NEW this paste
    ],
  })
)
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(2500)

decisions = await getDecisions()
const auth2 = decisions.find((d) => d.topic === 'Auth')
const hosting = decisions.find((d) => d.topic === 'Hosting')
if (auth2?.decided_at !== EXPLICIT_AT)
  fail(`carry-forward did not restore dropped stamps: ${JSON.stringify(auth2)}`)
else ok('carry-forward restored stamps the paste dropped')
if (!hosting?.decided_at || hosting.decided_in_session !== null)
  fail(`new pasted decision not stamped: ${JSON.stringify(hosting)}`)
else ok('new pasted decision stamped out-of-band')

// --- 5. Display after the paste round-trip ---
await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
if (!mainText.includes(`added ${shortDate(EXPLICIT_AT)}`))
  fail('restored stamp not rendered after paste (should still show the ORIGINAL date)')
else ok('restored stamp renders its original date, not today')
const hostingIdx = mainText.indexOf('Hosting')
if (hostingIdx < 0 || !mainText.slice(hostingIdx, hostingIdx + 80).includes(`added ${TODAY_SHORT}`))
  fail('new decision does not show today\'s "added" suffix')
else ok('new decision shows today\'s suffix')

// --- Cleanup ---
const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
  headers: { authorization: authHeader },
})
console.log(`cleanup DELETE → ${del.status()}`)

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: decision provenance verified (7 checks)')
