#!/usr/bin/env node
// #197 — contested locks on the Brief tab. Creates a brief whose locked
// decision carries a contest, grades: the Contested badge + three actions
// render inside Details, Dismiss saves `contest_dismissed` and clears the
// contest, and a raw-JSON save that drops the lock asks first.
// Usage: node scripts/e2e-197-lock-contest.mjs

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const payload = {
  _payload_type: 'new-project',
  title: `E2E197 lock contest ${stamp} — delete me`,
  brief: {
    problem: 'Customers cannot order online.',
    target_users: 'Local cafe customers.',
    features: ['Online ordering'],
    constraints: 'Web only.',
    additional_context: '',
    decisions: [
      { topic: 'Payments', decision: 'Stripe only', locked: true },
      { topic: 'Hosting', decision: 'Vercel', locked: false },
    ],
  },
}
// A contest only ever comes from regen, so the create route strips it; seed
// it the way regen's output lands — through PUT /api/briefs.
const CONTEST = { proposed: 'Square instead of Stripe', reason: 'Maker already has a Square account' }
let failures = 0
const grade = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`); if (!ok) failures++ }

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })
await page.getByRole('button', { name: 'New brief' }).first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(300)
await page.locator('#project-json').fill(JSON.stringify(payload))
const createRespP = page.waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
await page.getByRole('button', { name: 'Import & create' }).click()
const createResp = await createRespP
if (!createResp || createResp.status() !== 201) { console.error(`FAIL: create → ${createResp?.status()}`); await browser.close(); process.exit(1) }
const proj = await createResp.json()
const auth = createResp.request().headers()['authorization']
console.log(`created ${proj.id} (${proj.slug})`)

// Leftover from a previous run, if any.
if (process.env.E2E_STALE) await page.request.delete(`${BASE}/api/projects?project_id=${process.env.E2E_STALE}`, { headers: { authorization: auth } })
const getBrief = async () => (await page.request.get(`${BASE}/api/briefs?project_id=${proj.id}`, { headers: { authorization: auth } })).json()
const seeded = await getBrief()
const content = { ...seeded.content, decisions: seeded.content.decisions.map((d) => d.topic === 'Payments' ? { ...d, contested: CONTEST } : d) }
const seedPut = await page.request.put(`${BASE}/api/briefs`, { headers: { authorization: auth, 'content-type': 'application/json' }, data: JSON.stringify({ project_id: proj.id, content }) })
grade(seedPut.status() === 200, `seed contest via PUT → ${seedPut.status()}`)
const b0 = await getBrief()
const pay0 = b0.content?.decisions?.find((d) => d.topic === 'Payments')
grade(pay0?.locked === true && pay0?.contested?.proposed === 'Square instead of Stripe', 'PUT keeps contested on the locked decision')

await page.goto(`${BASE}/projects/${proj.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /^Details$/ }).click()
await page.waitForTimeout(500)
grade(await page.getByText('Contested', { exact: true }).first().isVisible().catch(() => false), 'Contested badge visible')
grade(await page.getByText(/Maker wants: Square instead of Stripe/).first().isVisible().catch(() => false), 'proposal + reason line visible')
const dismiss = page.getByRole('button', { name: /^Dismiss — Payments$/ })
grade(await page.getByRole('button', { name: /^Accept, keep locked — Payments$/ }).isVisible().catch(() => false), 'Accept, keep locked present')
grade(await page.getByRole('button', { name: /^Accept and unlock — Payments$/ }).isVisible().catch(() => false), 'Accept and unlock present')
await page.screenshot({ path: '/private/tmp/claude-501/-Users-nico-src-ibuild4you/05575e35-a31d-4738-af5e-cd5c083780f8/scratchpad/197-contest.png', fullPage: true })

const putP = page.waitForResponse((r) => r.url().includes('/api/briefs') && r.request().method() === 'PUT', { timeout: 15000 }).catch(() => null)
await dismiss.click()
const put = await putP
grade(put?.status() === 200, `Dismiss → PUT /api/briefs ${put?.status()}`)
await page.waitForTimeout(800)
const b1 = await getBrief()
const pay1 = b1.content?.decisions?.find((d) => d.topic === 'Payments')
grade(pay1?.locked === true && !pay1?.contested && pay1?.contest_dismissed?.proposed === 'Square instead of Stripe', 'dismiss clears contested, records contest_dismissed, keeps lock')
grade(!(await page.getByText('Contested', { exact: true }).first().isVisible().catch(() => false)), 'badge gone after dismiss')

// Lock-loss guard: raw-JSON save that drops the Payments lock asks first.
await page.getByRole('button', { name: /Edit brief/ }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: /Raw JSON/ }).click()
await page.waitForTimeout(300)
const ta = page.locator('textarea[rows="20"]')
const raw = JSON.parse(await ta.inputValue())
raw.decisions = raw.decisions.filter((d) => d.topic !== 'Payments')
await ta.fill(JSON.stringify(raw, null, 2))
await page.getByRole('button', { name: 'Save brief' }).click()
await page.waitForTimeout(600)
grade(await page.getByText(/This save removes the lock on: Payments/).isVisible().catch(() => false), 'guard asks before a save drops a lock')
await page.screenshot({ path: '/private/tmp/claude-501/-Users-nico-src-ibuild4you/05575e35-a31d-4738-af5e-cd5c083780f8/scratchpad/197-guard.png', fullPage: true })
const b2 = await getBrief()
grade(b2.content?.decisions?.some((d) => d.topic === 'Payments' && d.locked), 'nothing saved while the guard is up')
await page.getByRole('button', { name: 'Cancel' }).first().click()
await page.waitForTimeout(300)
const b3 = await getBrief()
grade(b3.content?.decisions?.some((d) => d.topic === 'Payments' && d.locked), 'Cancel keeps the lock')

const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, { headers: { authorization: auth } })
console.log(`cleanup DELETE → ${del.status()}`)
await browser.close()
console.log(failures ? `${failures} FAILED` : 'ALL PASS')
process.exit(failures ? 1 : 0)
