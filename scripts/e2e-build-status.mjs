#!/usr/bin/env node
// Build status return leg, end to end on preview. Walk-through, graded:
//   1. Throwaway brief (Import JSON), github_repo set to nicolovejoy/e2e-build-status.
//   2. Setup tab -> Advanced -> Mint; the shown-once key is read from its
//      read-only field into a file in the scratchpad (never printed).
//   3. scripts/smoke-build-status.mjs against preview with that key file:
//      401 / 401 / 400 / 201 / 200 duplicate.
//   4. Brief tab -> "Copy next-convo prep": the notice says 1 build report, and
//      the copied text has a <build_status> block with the report and a stamp
//      listing it (clipboard read through granted permissions, headless).
//   5. PUT /api/briefs with that stamp -> 200, the report is folded, and
//      GET /api/build-status lists none.
//   6. Setup tab -> Revoke; the smoke script's good report now gets 401.
// The key file is deleted, the key revoked and the brief deleted at the end,
// pass or fail.
// Needs .ibuild4you-bypass + .test-admin-password (the test admin is a system
// admin, which minting needs).
// Usage: node scripts/e2e-build-status.mjs [--key-dir <dir>]
//   --key-dir  where the key file goes (default: the OS temp dir)

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchLoggedIn, BASE, ROOT } from './lib/preview-login.mjs'
import { bypassFor, goodReport, postReport } from './smoke-build-status.mjs'

const REPO = 'nicolovejoy/e2e-build-status'
const stamp = Math.floor(performance.now()).toString(36) + Date.now().toString(36).slice(-4)
const TITLE = `e2e-build-status ${stamp} - delete me`

const keyDirArg = process.argv.indexOf('--key-dir')
const keyDir = mkdtempSync(join(keyDirArg > -1 ? process.argv[keyDirArg + 1] : tmpdir(), 'e2e-bsk-'))
const keyFile = join(keyDir, 'key')

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, ctx, page } = await launchLoggedIn()
// The prep copy writes to the clipboard; reading it back needs both.
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
// Mint a new key and Revoke ask through window.confirm.
page.on('dialog', (d) => d.accept())

let projectId = null
let slug = null
let auth = null
let keyLive = false

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

const BRIEF = {
  problem: 'Dog walkers cannot take bookings online',
  target_users: 'Local dog owners',
  features: ['Booking page'],
  constraints: 'Mobile first',
  additional_context: '',
  decisions: [],
  open_risks: [],
}

const openAdvanced = async () => {
  await page.goto(`${BASE}/projects/${slug}?tab=settings`, { waitUntil: 'domcontentloaded' })
  // Connections starts folded on the Settings tab.
  await page.getByRole('button', { name: /^Connections/ }).click()
  await page.getByRole('heading', { name: `Build status key for ${REPO}` }).waitFor({ timeout: 15000 })
}

try {
  // 1. Create through the Import JSON modal, which also captures the builder token.
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: TITLE,
    welcome_message: `Hello ${stamp}, tell me about your idea.`,
    brief: BRIEF,
  }))
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

  const patch = await call('PATCH', '/api/projects', { project_id: projectId, github_repo: REPO })
  grade(patch.status() === 200, `PATCH github_repo -> ${patch.status()}`)

  // 2. Mint on the Setup tab. A key left by an earlier run shows "Mint a new key".
  await openAdvanced()
  await page.getByRole('button', { name: /^Mint/ }).click()
  // Set at once: the mint may land even if reading the field below fails, and
  // the cleanup must still revoke it.
  keyLive = true
  const keyField = page.locator(`#build-status-key-${projectId}`)
  await keyField.waitFor({ timeout: 15000 })
  const key = (await keyField.inputValue()).trim()
  grade(/^bsk_/.test(key), 'minted key shown in the read-only field (value not printed)')
  writeFileSync(keyFile, key, { mode: 0o600 })

  // 3. The smoke script, as its own process, on the key file.
  const smoke = spawnSync(
    process.execPath,
    [`${ROOT}scripts/smoke-build-status.mjs`, '--base', BASE, '--repo', REPO, '--project', slug, '--key-file', keyFile],
    { encoding: 'utf8' }
  )
  for (const l of `${smoke.stdout}${smoke.stderr}`.trim().split('\n')) console.log(`  smoke | ${l}`)
  grade(smoke.status === 0, `smoke script exit ${smoke.status}`)

  const before = await (await call('GET', `/api/build-status?project_id=${projectId}`)).json()
  grade(before.reports?.length === 1, `GET /api/build-status lists 1 unfolded report (got ${before.reports?.length})`)
  const reportId = before.reports?.[0]?.id

  // 4. Copy the prep on the Brief tab.
  await page.goto(`${BASE}/projects/${slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
  const copyButton = page.getByRole('button', { name: 'Copy next-convo prep' })
  await copyButton.waitFor({ timeout: 15000 })
  // Disabled until the project loads.
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Copy next-convo prep' && !b.disabled),
    null,
    { timeout: 15000 }
  )
  await copyButton.click()
  const notice = page.getByText('Includes 1 build report from Code.')
  const noticeShown = await notice.waitFor({ timeout: 15000 }).then(() => true, () => false)
  grade(noticeShown, 'notice "Includes 1 build report from Code."')

  const prep = await page.evaluate(() => navigator.clipboard.readText())
  const block = /<build_status>\n([\s\S]*?)\n<\/build_status>/.exec(prep)?.[1] ?? ''
  grade(block.includes(`<report id="${reportId}"`), 'copied prep has a <build_status> block with the report')
  grade(block.includes('Smoke test report') && block.includes('Questions for the maker:'), 'the block carries the report\'s live item and question')
  const stampJson = /<prep_stamp>\n([\s\S]*?)\n<\/prep_stamp>/.exec(prep)?.[1]
  const prepStamp = stampJson ? JSON.parse(stampJson) : null
  grade(
    JSON.stringify(prepStamp?.report_ids) === JSON.stringify([reportId]),
    `prep stamp lists the report (report_ids: ${prepStamp?.report_ids?.length ?? 'none'})`
  )

  // 5. A paste carrying that stamp folds the report.
  const put = await call('PUT', '/api/briefs', { project_id: projectId, content: BRIEF, source: 'paste', prep_stamp: prepStamp })
  const putBody = await put.json().catch(() => ({}))
  grade(put.status() === 200, `PUT /api/briefs with the stamp -> ${put.status()}`)
  grade(JSON.stringify(putBody.folded_reports) === JSON.stringify([reportId]), 'the paste folded the report')
  const after = await (await call('GET', `/api/build-status?project_id=${projectId}`)).json()
  grade(after.reports?.length === 0 && !!after.latest_posted_at, `GET /api/build-status lists 0 after the paste (got ${after.reports?.length})`)

  // 6. Revoke on the Setup tab; the good report is refused.
  await openAdvanced()
  await page.getByRole('button', { name: 'Revoke', exact: true }).click()
  const revoked = await page.getByText('No key yet.').waitFor({ timeout: 15000 }).then(() => true, () => false)
  grade(revoked, 'Revoke -> the panel says "No key yet."')
  if (revoked) keyLive = false
  const refused = await postReport({
    base: BASE,
    bypass: bypassFor(BASE),
    key,
    body: goodReport({ repo: REPO, project: slug, tag: `${stamp}-after-revoke` }),
  })
  grade(refused.status === 401, `good report after revoke -> ${refused.status}`)
} catch (e) {
  console.error(`FAIL: ${String(e.message).split('\n')[0]}`)
  failures++
} finally {
  rmSync(keyDir, { recursive: true, force: true })
  console.log('key file deleted')
  if (projectId && auth) {
    if (keyLive) {
      const rv = await call('DELETE', `/api/build-status/key?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
      console.log(`cleanup key DELETE -> ${rv.status()}`)
    }
    const del = await call('DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
