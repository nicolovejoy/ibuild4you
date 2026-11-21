#!/usr/bin/env node
// Project email address (email-in), the part preview can check. Preview
// receives no mail, so this covers the address only:
//   1. Throwaway brief (Import JSON).
//   2. Setup tab -> Advanced: the "Project email" panel says there is no
//      address and offers to create one.
//   3. Create: an address at the inbox host shows in the read-only field.
//   4. Reload: the same address is still there, and nothing is listed as
//      received or dropped.
//   5. GET /api/projects/email-in returns that address; a second POST returns
//      it unchanged.
// The brief is deleted at the end, pass or fail.
// Needs .ibuild4you-bypass + .test-admin-password (the test admin is an owner).
// Usage: node scripts/e2e-email-in.mjs [--shot <file.png>]

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36) + Date.now().toString(36).slice(-4)
const TITLE = `e2e-email-in ${stamp} - delete me`
const shotArg = process.argv.indexOf('--shot')
const shotFile = shotArg > -1 ? process.argv[shotArg + 1] : null

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()

let projectId = null
let slug = null
let auth = null

// Errors are cut to their first line: Playwright's full error echoes headers
// (Bearer token, bypass cookie).
const call = (method, path, data) =>
  page.request
    .fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    .catch((e) => {
      throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`)
    })

const openPanel = async () => {
  await page.goto(`${BASE}/projects/${slug}?tab=settings`, { waitUntil: 'domcontentloaded' })
  // Connections starts folded on the Settings tab.
  await page.getByRole('button', { name: /^Connections/ }).click()
  await page.getByRole('heading', { name: 'Project email' }).waitFor({ timeout: 15000 })
}

const ADDRESS = /^[a-z0-9-]+-[a-z2-9]{4}@inbox\.ibuild4you\.com$/

try {
  // 1. Create through the Import JSON modal, which also captures the builder token.
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(
    JSON.stringify({ _payload_type: 'new-project', title: TITLE, welcome_message: `Hello ${stamp}.` })
  )
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  const proj = await resp.json()
  projectId = proj.id
  slug = proj.slug
  auth = resp.request().headers()['authorization']
  console.log(`created ${proj.id} (${proj.slug})`)

  // 2. No address yet.
  await openPanel()
  const none = await page.getByText('No address yet.').waitFor({ timeout: 15000 }).then(() => true, () => false)
  grade(none, 'panel says "No address yet."')

  // 3. Create it.
  await page.getByRole('button', { name: 'Create project email address' }).click()
  const field = page.locator(`#project-email-${projectId}`)
  await field.waitFor({ timeout: 15000 })
  const address = (await field.inputValue()).trim()
  grade(ADDRESS.test(address), `an address at the inbox host is shown (${address})`)
  const createGone = (await page.getByRole('button', { name: 'Create project email address' }).count()) === 0
  grade(createGone, 'the create button is gone')

  // 4. It survives a reload.
  await openPanel()
  await field.waitFor({ timeout: 15000 })
  grade((await field.inputValue()).trim() === address, 'the same address after a reload')
  const nothing = await page.getByText('Nothing received yet.').waitFor({ timeout: 15000 }).then(() => true, () => false)
  grade(nothing, 'panel says "Nothing received yet."')
  if (shotFile) {
    await page.getByRole('heading', { name: 'Project email' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: shotFile })
    console.log(`screenshot: ${shotFile}`)
  }

  // 5. The API agrees, and a second mint changes nothing.
  const got = await call('GET', `/api/projects/email-in?project_id=${projectId}`)
  const body = await got.json()
  grade(got.status() === 200 && body.address === address, `GET returns the address (${got.status()})`)
  grade(Array.isArray(body.recent) && body.recent.length === 0, 'GET lists nothing received')
  const again = await call('POST', '/api/projects/email-in', { project_id: projectId })
  grade(again.status() === 200 && (await again.json()).address === address, `a second POST returns the same address (${again.status()})`)
} catch (e) {
  grade(false, `threw: ${String(e.message).split('\n')[0]}`)
} finally {
  if (projectId) {
    const del = await call('DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
