#!/usr/bin/env node
// Verify decision revisions (#218) on preview without paying for a regen:
//  1. Create a brief via POST /api/projects with one decision carrying an
//     EXPLICIT origin (decided_at in July).
//  2. Paste (PUT /api/briefs) the same topic with new text → the origin stays,
//     revised_at is today, revised_in_session null (out-of-band).
//  3. Paste again with a third text → origin unchanged, revised_at replaced.
//  4. The Brief tab shows "added Jul 1, revised <today>".
// Cleans up after.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const ORIGIN_AT = '2026-07-01T00:00:00Z'
const briefFields = {
  problem: 'Customers cannot order online.',
  target_users: 'Local cafe customers.',
  features: ['Online ordering'],
  constraints: 'Web only.',
  additional_context: '',
}
const shortDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const TODAY = new Date().toISOString()

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })
// Capture the Bearer token from the app's own API calls (see e2e-214/220).
let auth = null
page.on('request', (r) => { const a = r.headers()['authorization']; if (a && /\/api\//.test(r.url())) auth = a })
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 40 && !auth; i++) await page.waitForTimeout(250)
if (!auth) { console.error('FAIL: no bearer token captured'); await browser.close(); process.exit(1) }
const hdr = { authorization: auth, 'content-type': 'application/json' }

let projectId
try {
  // --- 1. Create ---
  const createResp = await page.request.post(`${BASE}/api/projects`, {
    headers: hdr,
    data: {
      title: `Revision e2e ${stamp}`,
      brief: {
        ...briefFields,
        decisions: [{ topic: 'Auth', decision: 'Google', decided_in_session: null, decided_at: ORIGIN_AT }],
      },
    },
  })
  if (createResp.status() !== 201) { fail(`create → ${createResp.status()}`); throw new Error('stop') }
  const brief = await createResp.json()
  projectId = brief.id
  console.log(`created brief ${projectId} (${brief.slug})`)

  const getAuthDecision = async () => {
    const r = await page.request.get(`${BASE}/api/briefs?project_id=${projectId}`, { headers: hdr })
    const b = await r.json()
    return (b?.content?.decisions || []).find((d) => d.topic === 'Auth')
  }
  const paste = async (decision) => {
    const r = await page.request.put(`${BASE}/api/briefs`, {
      headers: hdr,
      data: { project_id: projectId, content: { ...briefFields, decisions: [{ topic: 'Auth', decision }] }, source: 'paste' },
    })
    if (r.status() !== 200) fail(`PUT → ${r.status()} ${await r.text()}`)
  }

  // --- 2. First revision ---
  await paste('Google + passcode')
  let d = await getAuthDecision()
  if (d?.decided_at !== ORIGIN_AT) fail(`origin overwritten: ${JSON.stringify(d)}`)
  else ok('origin decided_at kept through a revision')
  if (!d?.revised_at || d.revised_at.slice(0, 10) !== TODAY.slice(0, 10) || d.revised_in_session !== null)
    fail(`revision not stamped out-of-band today: ${JSON.stringify(d)}`)
  else ok('revised_at stamped today, revised_in_session null')
  const firstRevisedAt = d?.revised_at

  // --- 3. Second revision replaces the first ---
  await new Promise((r) => setTimeout(r, 1100))
  await paste('Passcode only')
  d = await getAuthDecision()
  if (d?.decided_at !== ORIGIN_AT) fail(`origin overwritten on second revision: ${JSON.stringify(d)}`)
  else ok('origin still stands after a second revision')
  if (!d?.revised_at || d.revised_at === firstRevisedAt) fail(`second revision did not replace the first: ${JSON.stringify(d)}`)
  else ok('latest revision replaced the earlier one')

  // --- 4. Brief tab suffix ---
  await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
  // The read view sits inside the ferry desk's collapsed Details fold.
  const details = page.getByRole('button', { name: /^Details$/ })
  await details.waitFor({ timeout: 15000 })
  await details.click()
  const expected = `added ${shortDate(ORIGIN_AT)}, revised ${shortDate(TODAY)}`
  const found = await page.getByText(expected, { exact: false }).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  if (!found) fail(`suffix "${expected}" not rendered`)
  else ok(`Brief tab shows "${expected}"`)

  // --- 5. Editor-style paste: the stored decision spread back with new text must restamp ---
  const stored = await getAuthDecision()
  const r5 = await page.request.put(`${BASE}/api/briefs`, {
    headers: hdr,
    data: { project_id: projectId, content: { ...briefFields, decisions: [{ ...stored, decision: 'Magic link' }] }, source: 'paste' },
  })
  if (r5.status() !== 200) fail(`PUT (spread) → ${r5.status()}`)
  d = await getAuthDecision()
  if (d?.decided_at !== ORIGIN_AT || !d?.revised_at || d.revised_at === stored?.revised_at)
    fail(`echoed revised_* was not restamped: ${JSON.stringify(d)}`)
  else ok('spread-back paste with new text restamps the revision')
} catch (e) {
  if (e.message !== 'stop') { fail(e.message) }
} finally {
  if (projectId) {
    const del = await page.request.delete(`${BASE}/api/projects?project_id=${projectId}`, { headers: hdr }).catch(() => null)
    console.log(`cleanup DELETE → ${del?.status()}`)
  }
  await browser.close()
}
console.log(process.exitCode ? 'FAILED' : 'PASS: decision revisions verified (6 checks)')
