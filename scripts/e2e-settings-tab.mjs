#!/usr/bin/env node
// The builder Settings tab and the Conversations tab's "Next round" panel:
//   1. Throwaway brief (Import JSON) with a welcome and two seed questions.
//   2. The nav has three tabs: Brief, Conversations, Settings.
//   3. An old ?tab=people link lands on Settings. People and Sam are open,
//      Connections is folded, and there is no Save button and no opening
//      message field.
//   4. A switch saves on its own: turn on "Don't show the brief title in link
//      previews", reload, and it is still on (and the API agrees).
//   5. The language saves on its own, and the Sam heading follows it.
//   6. Archive flips to Unarchive, survives a reload, and flips back.
//   7. Delete sits below Archive (the test admin is a system admin).
//   8. Conversations: "Next round" starts folded, opens to show the welcome
//      and the seed questions, and has nothing to type in.
// The brief is deleted at the end, pass or fail.
// Needs .ibuild4you-bypass + .test-admin-password (the test admin is an owner).
// Usage: node scripts/e2e-settings-tab.mjs [--shot <dir>]
// --shot also saves the Brief tab and all three tabs at a phone width.

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36) + Date.now().toString(36).slice(-4)
const TITLE = `e2e-settings ${stamp} - delete me`
const WELCOME = `Hello ${stamp}, tell me about your idea.`
const shotArg = process.argv.indexOf('--shot')
const shotDir = shotArg > -1 ? process.argv[shotArg + 1] : null

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

const shot = async (name) => {
  if (!shotDir) return
  await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true })
  console.log(`screenshot: ${shotDir}/${name}.png`)
}

const section = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) })
const openSettings = async (tab = 'settings') => {
  await page.goto(`${BASE}/projects/${slug}?tab=${tab}`, { waitUntil: 'domcontentloaded' })
  await section('Sam').waitFor({ timeout: 15000 })
}
const project = async () => (await call('GET', `/api/projects?slug=${slug}`)).json()
// Wait for a save (PATCH) to come back before reading the result.
const saved = () =>
  page.waitForResponse((r) => /\/api\/projects(\/archive)?$/.test(r.url()) && r.request().method() === 'PATCH', {
    timeout: 15000,
  })

try {
  // 1. Create through the Import JSON modal, which also captures the builder token.
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(
    JSON.stringify({
      _payload_type: 'new-project',
      title: TITLE,
      welcome_message: WELCOME,
      seed_questions: ['What does a busy morning look like?', 'Who else uses it?'],
    })
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

  // 2 + 3. An old link lands on Settings; three tabs; the right things are open.
  await openSettings('people')
  const rail = page.locator('aside nav')
  const tabs = (await rail.getByRole('button').allInnerTexts()).map((s) => s.trim())
  grade(JSON.stringify(tabs) === JSON.stringify(['Brief', 'Conversations', 'Settings']), `three tabs (${tabs.join(', ')})`)
  grade((await section('People').getAttribute('aria-expanded')) === 'true', 'People is open')
  grade((await section('Sam').getAttribute('aria-expanded')) === 'true', 'Sam is open')
  grade((await section('Connections').getAttribute('aria-expanded')) === 'false', 'Connections is folded')
  const main = page.locator('main')
  grade((await main.getByRole('button', { name: /^Save/ }).count()) === 0, 'no Save button')
  grade((await main.getByText(/Opening message|Seed questions|Nudge override/).count()) === 0, 'no per-round fields')
  await openSettings('setup')
  grade(true, 'an old ?tab=setup link lands on Settings too')
  await shot('settings')

  // 4. A switch saves on its own.
  const hide = page.getByLabel(/Don't show the brief title in link previews/)
  let done = saved()
  await hide.check()
  await done
  grade((await project()).hide_title_in_previews === true, 'the link-preview switch saved without a Save button')
  await openSettings()
  grade(await hide.isChecked(), 'and is still on after a reload')

  // 5. The language saves on its own, and the heading follows.
  done = saved()
  await page.getByLabel("Maker's language").selectOption('fr')
  await done
  grade((await project()).language === 'fr', 'the language saved')
  grade(/French/.test(await section('Sam').innerText()), 'the Sam heading says French')

  // 6. Archive, reload, unarchive.
  done = saved()
  await page.getByRole('button', { name: 'Archive brief' }).click()
  await done
  await page.getByRole('button', { name: 'Unarchive brief' }).waitFor({ timeout: 15000 })
  grade((await project()).viewer_archived === true, 'archived for this viewer')
  await openSettings()
  const stillArchived = await page.getByRole('button', { name: 'Unarchive brief' }).waitFor({ timeout: 15000 }).then(() => true, () => false)
  grade(stillArchived, 'still archived after a reload')
  done = saved()
  await page.getByRole('button', { name: 'Unarchive brief' }).click()
  await done
  grade((await project()).viewer_archived === false, 'unarchived')

  // 7. Delete sits below Archive.
  const archiveY = (await page.getByRole('button', { name: 'Archive brief' }).boundingBox())?.y
  const deleteY = (await page.getByRole('button', { name: 'Delete brief' }).boundingBox())?.y
  grade(archiveY != null && deleteY != null && archiveY < deleteY, 'Archive is just above Delete')

  // Folding a section hides its controls.
  await section('Sam').click()
  grade((await page.getByLabel("Maker's language").count()) === 0, 'folding Sam hides its controls')

  // 8. Conversations: the read-only Next round panel.
  await page.goto(`${BASE}/projects/${slug}?tab=conversations`, { waitUntil: 'domcontentloaded' })
  const next = section('Next round')
  await next.waitFor({ timeout: 15000 })
  grade((await next.getAttribute('aria-expanded')) === 'false', 'Next round starts folded')
  await next.click()
  const panelText = await page.locator('dl').first().innerText()
  grade(panelText.includes(WELCOME), 'Next round shows the welcome, word for word')
  grade(panelText.includes('What does a busy morning look like?'), 'and the seed questions')
  grade((await page.locator('dl').first().locator('input, textarea, select').count()) === 0, 'with nothing to type in')
  await shot('conversations')

  // Screenshots only, nothing graded: the Brief tab, then each tab at a phone width.
  if (shotDir) {
    await page.goto(`${BASE}/projects/${slug}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Brief' }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(1500)
    await shot('brief')
    await page.setViewportSize({ width: 390, height: 844 })
    for (const tab of ['brief', 'conversations', 'settings']) {
      await page.goto(`${BASE}/projects/${slug}?tab=${tab}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
      await shot(`phone-${tab}`)
    }
  }
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
