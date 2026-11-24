#!/usr/bin/env node
// Verify the paste status line on the Brief tab (relay Project 5) on preview:
//  1. Before the first paste there is no line.
//  2. After an import, the line says the paste is current and names the
//     pasted version.
// The "used" states need a maker message; the test admin resolves to owner,
// so they are covered by unit tests only (lib/builder, FerryDesk).
// Creates a brief via Import JSON, drives, deletes. Screenshot path is argv[2].

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const shot = process.argv[2] || null
const stamp = Math.floor(performance.now()).toString(36)
const payload = {
  _payload_type: 'new-project',
  title: `Paste status e2e ${stamp}`,
  brief: { problem: 'Customers cannot order online.', features: ['Online ordering'] },
}

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

await page.getByRole('button', { name: 'New brief' }).first().click()
await page.waitForTimeout(400)
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

try {
  // --- 1. No line before the first paste ---
  await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('stamp-pasted').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  if (await page.getByTestId('paste-status').count()) fail('status line shown before any paste')
  else ok('no status line before the first paste')

  // --- 2. Import, come back: the paste is current ---
  await page.getByPlaceholder(/prep chat/).fill(
    JSON.stringify({ ...payload.brief, problem: `Updated problem ${stamp}` })
  )
  // The stamp is its own PATCH after the brief save: wait for it, or the
  // navigation below aborts it.
  const stampRespP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 20000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import JSON' }).click()
  const stampResp = await stampRespP
  if (!stampResp || stampResp.status() !== 200) fail(`stamp PATCH → ${stampResp?.status()}`)
  await page.goto(`${BASE}/projects/${brief.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
  const line = page.getByTestId('paste-status')
  await line.waitFor({ timeout: 15000 }).catch(() => {})
  const text = (await line.textContent().catch(() => null)) || ''
  console.log(`status line: ${text}`)
  if (!/^The paste of .+ is current: .+ has not written since\.$/.test(text)) fail(`unexpected line: "${text}"`)
  else ok('status line says the paste is current')
  if (shot) {
    await page.screenshot({ path: shot })
    console.log(`screenshot: ${shot}`)
  }
} finally {
  const del = await page.request.delete(`${BASE}/api/projects?project_id=${brief.id}`, {
    headers: { authorization: authHeader },
  })
  console.log(`cleanup DELETE → ${del.status()}`)
  await browser.close()
}
console.log(process.exitCode ? 'FAILED' : 'PASS: paste status line verified')
