#!/usr/bin/env node
// Three things left unseen in a browser after PRs #289, #297 and #298, checked
// on preview with one throwaway brief and the test cast. Graded, nothing
// adjusted to pass.
//
//   P  Paste status line on the Brief tab (#298): "current" after an import,
//      "used ... Next: copy the prep" once the maker has written, and
//      "Next: paste the new payload" once the prep is copied.
//   I  Inviting a removed member (#297): what the Invite window shows for
//      the 409.
//   M  Modal screens (#289): each one has a name, takes focus, keeps Tab
//      inside, has a visible Close button, closes on Escape and gives focus
//      back to the control that opened it. Covered here: Waiting on maker,
//      Maker access (Share), Invite, Send email now, Start conversation,
//      Set password. Not covered: the stored-email viewer (preview receives
//      no mail) and the file preview.
//
// The maker is a test-cast identity. Needs .test-cast-passwords.json.
// Headless Chromium only. Screenshots go to E2E_SHOT_DIR.
// Usage: E2E_SHOT_DIR=<dir> node scripts/e2e-loose-ends-298.mjs

import { existsSync, mkdirSync } from 'node:fs'
import { launchLoggedIn, loginWithPassword, readCastPassword, BASE, ROOT, shotDir } from './lib/preview-login.mjs'

if (!existsSync(`${ROOT}.test-cast-passwords.json`)) {
  console.log('SKIPPED: no test cast passwords')
  process.exit(0)
}

const SHOTS = process.env.E2E_SHOT_DIR || shotDir
mkdirSync(SHOTS, { recursive: true })

const stamp = Math.floor(performance.now()).toString(36)
const MAKER = 'test-originator@ibuild4you.com'
const SECOND = 'test-contributor@ibuild4you.com'
const THIRD = 'test-reviewer@ibuild4you.com'
const BRIEF = { problem: 'Customers cannot book online.', target_users: 'Local dog owners.', features: ['Online booking'] }

let failures = 0
const grade = (ok, label, evidence) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${evidence ? `  [${evidence}]` : ''}`)
  if (!ok) failures++
}
const note = (label, evidence) => console.log(`NOTE: ${label}${evidence ? `  [${evidence}]` : ''}`)
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim()

const { browser, ctx, page } = await launchLoggedIn()
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {})

const call = (pg, auth, method, path, data) =>
  pg.request
    .fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    .catch((e) => {
      throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`)
    })
const msgsOf = async (auth, sid) => {
  const m = await (await call(page, auth, 'GET', `/api/messages?session_id=${sid}`)).json()
  return Array.isArray(m) ? m : []
}

// Describe the focused element, for the "focus came back" check.
const focused = (pg = page) =>
  pg.evaluate(() => {
    const a = document.activeElement
    if (!a || a === document.body) return '(body)'
    return `${a.tagName.toLowerCase()} "${(a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`
  })

// One modal screen: opener is a locator; it is clicked, the dialog graded,
// then closed with Escape. `inside` runs while the dialog is open.
async function checkModal(key, opener, { expectTitle, inside } = {}) {
  if (!(await opener.count())) {
    grade(false, `M ${key}: opener found`)
    return
  }
  await opener.first().focus()
  const openerDesc = await focused()
  await opener.first().click()
  const dlg = page.getByRole('dialog')
  await dlg.first().waitFor({ timeout: 6000 }).catch(() => {})
  const n = await dlg.count()
  grade(n === 1, `M ${key}: one dialog opens`, `${n} dialog(s)`)
  if (n === 0) return
  const info = await dlg.first().evaluate((d) => {
    const labelled = d.getAttribute('aria-labelledby')
    const name = labelled ? document.getElementById(labelled)?.textContent : d.getAttribute('aria-label')
    const backdrop = d.previousElementSibling
    const close = d.querySelector('button[aria-label="Close"], button[aria-label="Fermer"]')
    const cs = close ? getComputedStyle(close) : null
    const r = close?.getBoundingClientRect()
    return {
      name: (name || '').trim(),
      modal: d.getAttribute('aria-modal'),
      focusInside: d.contains(document.activeElement),
      backdrop: backdrop ? getComputedStyle(backdrop).backgroundColor : '(none)',
      closeLabel: close?.getAttribute('aria-label') || null,
      closeVisible: !!close && r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0',
      closeColor: cs ? `${cs.color} on ${cs.backgroundColor}` : null,
    }
  })
  grade(!!info.name && (!expectTitle || expectTitle.test(info.name)), `M ${key}: the dialog has a name`, `"${info.name}"`)
  grade(info.modal === 'true', `M ${key}: aria-modal`)
  grade(info.focusInside, `M ${key}: focus is inside on open`, await focused())
  grade(/0\.5\)|\/ 0\.5/.test(info.backdrop), `M ${key}: backdrop is half-transparent black`, info.backdrop)
  grade(info.closeLabel === 'Close' && info.closeVisible, `M ${key}: Close button visible and named`, `${info.closeLabel}, ${info.closeColor}`)
  await page.screenshot({ path: `${SHOTS}/M-${key}.png` })
  // Tab 25 times: focus must stay in the dialog every time.
  let escaped = 0
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const inDlg = await dlg.first().evaluate((d) => d.contains(document.activeElement)).catch(() => false)
    if (!inDlg) escaped++
  }
  grade(escaped === 0, `M ${key}: Tab stays inside (25 presses)`, `${escaped} outside`)
  if (inside) await inside(dlg.first())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const left = await page.getByRole('dialog').count()
  grade(left === 0, `M ${key}: Escape closes it`, `${left} dialog(s) left`)
  if (left > 0) {
    // Do not leave a dialog over the page for the next check.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  }
  const back = await focused()
  grade(back === openerDesc, `M ${key}: focus returns to the opener`, `opener ${openerDesc}, now ${back}`)
}

const statusLine = async () => {
  const line = page.getByTestId('paste-status')
  await line.waitFor({ timeout: 12000 }).catch(() => {})
  return squash(await line.textContent().catch(() => ''))
}
const openTab = async (slug, tab, wait = 3500) => {
  await page.goto(`${BASE}/projects/${slug}?tab=${tab}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
}

let proj = null
let auth = null
try {
  // ===== Setup: a brief with a maker and an unanswered welcome =====
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: `e2e loose ends ${stamp} — delete me`,
    requester_email: MAKER,
    requester_first_name: 'Mara',
    welcome_message: `e2e welcome ${stamp}.`,
    brief: BRIEF,
  }))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  proj = await resp.json()
  auth = resp.request().headers()['authorization']
  console.log(`created ${proj.id} (${proj.slug})`)
  const sessions = await (await call(page, auth, 'GET', `/api/sessions?project_id=${proj.id}`)).json()
  const s1 = sessions[0]

  // ===== M: the two modals of the waiting state =====
  console.log('--- M: Waiting on maker, Maker access')
  await openTab(proj.slug, 'conversations', 4500)
  await checkModal('waiting-on-maker', page.getByRole('button', { name: /^Nudge/ }), { expectTitle: /^Waiting on / })
  await checkModal('maker-access', page.getByRole('button', { name: /Mara/i }), { expectTitle: /Maker access/ })

  // ===== P: paste status line =====
  console.log('--- P: paste status line')
  await openTab(proj.slug, 'brief')
  await page.getByPlaceholder(/prep chat/).fill(JSON.stringify({ ...BRIEF, problem: `Updated problem ${stamp}` }))
  const stampP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 20000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import JSON' }).click()
  const stampResp = await stampP
  grade(stampResp?.status() === 200, 'P: import stamps the paste', `PATCH ${stampResp?.status()}`)
  await page.waitForTimeout(1500)
  await openTab(proj.slug, 'brief')
  const l1 = await statusLine()
  grade(/^The paste of .+ \(v\d+\) is current: Mara has not written since\.$/.test(l1), 'P: "current" line', l1)
  await page.screenshot({ path: `${SHOTS}/P1-current.png` })

  // The maker writes.
  const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const mpage = await mctx.newPage()
  await loginWithPassword(mpage, { email: MAKER, password: readCastPassword(MAKER), path: `/projects/${proj.slug}` })
  const box = mpage.getByPlaceholder('Type a message...')
  for (let i = 0; i < 20; i++) {
    if (await box.isVisible().catch(() => false)) break
    if ((await mpage.locator('body').innerText().catch(() => '')).includes('What should we call you?')) {
      await mpage.locator('input:visible').first().fill('Mara')
      await mpage.getByRole('button', { name: 'Continue' }).click()
    }
    await mpage.waitForTimeout(2000)
  }
  if (!(await box.isVisible().catch(() => false))) throw new Error('maker composer never appeared')
  const SAID = 'I want a booking page for my dog-walking service.'
  await box.fill(SAID)
  await box.press('Control+Enter')
  let replied = false
  for (let i = 0; i < 40 && !replied; i++) {
    await mpage.waitForTimeout(2000)
    const now = await msgsOf(auth, s1.id)
    replied = now.filter((m) => m.role === 'agent').length > 1 && now.some((m) => m.role === 'user' && m.content === SAID)
  }
  grade(replied, 'P: the maker wrote and Sam replied')
  await mctx.close()

  await openTab(proj.slug, 'brief')
  const l2 = await statusLine()
  grade(/^The paste of .+ is used: Mara has written since\. Next: copy the prep\.$/.test(l2), 'P: "used" line after the maker writes', l2)
  await page.screenshot({ path: `${SHOTS}/P2-used.png` })

  // Copy the prep with the real button.
  const prepP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 30000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Copy next-convo prep' }).click()
  const prepResp = await prepP
  grade(prepResp?.status() === 200, 'P: Copy prep stamps prep_copied_at', `PATCH ${prepResp?.status()}`)
  await page.waitForTimeout(1500)
  const l3live = squash(await page.getByTestId('paste-status').textContent().catch(() => ''))
  const WANT3 = /^The paste of .+ is used, and you copied the prep after Mara last wrote\. Next: paste the new payload\.$/
  grade(WANT3.test(l3live), 'P: line changes to "paste the new payload" with no reload', l3live)
  await page.screenshot({ path: `${SHOTS}/P3-used-prep-copied.png` })
  await openTab(proj.slug, 'brief')
  const l3 = await statusLine()
  grade(WANT3.test(l3), 'P: the same line after a reload', l3)

  // ===== M: Start conversation (the maker has answered) =====
  console.log('--- M: Start conversation')
  await openTab(proj.slug, 'conversations', 4500)
  await checkModal('start-conversation', page.getByRole('button', { name: /^Start conversation 2/ }), { expectTitle: /^Start conversation 2\?$/ })

  // ===== I: invite a removed member =====
  console.log('--- I: invite a removed member')
  const add = await call(page, auth, 'POST', '/api/projects/share', {
    project_id: proj.id, email: SECOND, first_name: 'Tomas', brief_role: 'contributor',
  })
  grade(add.status() === 200 || add.status() === 201, 'I: second member added (setup)', `status ${add.status()}`)
  await openTab(proj.slug, 'settings', 4000)
  const row = page.locator('li', { hasText: SECOND }).first()
  grade((await row.count()) > 0, 'I: the member shows under People', `${await row.count()} row(s)`)
  await row.getByLabel('Remove from brief').click()
  await page.getByText(/Remove .* from this brief\?/).first().waitFor({ timeout: 6000 }).catch(() => {})
  await page.getByRole('button', { name: 'Remove', exact: true }).first().click()
  await page.waitForTimeout(2500)
  const inRemoved = await page.locator('li', { hasText: SECOND }).filter({ hasText: 'Restore' }).count()
  grade(inRemoved > 0, 'I: the member is under Removed with Restore')

  const inviteBtn = page.getByRole('button', { name: 'Invite', exact: true })
  await checkModal('invite', inviteBtn, { expectTitle: /^Invite someone to this brief$/ })
  await inviteBtn.first().click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('input[placeholder="First name"]').fill('Tomas')
  await dlg.locator('input[type="email"]').fill(SECOND)
  const shareP = page
    .waitForResponse((r) => /\/api\/projects\/share$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await dlg.getByRole('button', { name: 'Share', exact: true }).click()
  const shareResp = await shareP
  grade(shareResp?.status() === 409, 'I: the invite answers 409', `status ${shareResp?.status()}`)
  // The share hook does not retry (lib/query/hooks.ts, useShareProject), so the message should follow the first 409 at once.
  const MSG = 'This person was removed from the brief. Restore them under People instead of inviting them again.'
  const t0 = Date.now()
  await dlg.getByText(MSG).first().waitFor({ timeout: 10000 }).catch(() => {})
  note('I: time from the first 409 to the message on screen', `${Date.now() - t0} ms`)
  const dlgText = squash(await dlg.innerText().catch(() => ''))
  grade(dlgText.includes(MSG), 'I: the Invite window shows the message', dlgText.slice(0, 260))
  grade((await dlg.count()) === 1 && (await dlg.locator('input[type="email"]').inputValue()) === SECOND,
    'I: the window stays open with the address still in the form')
  const errBox = await dlg.getByText(MSG).first().evaluate((el) => {
    const box = el.closest('[role="alert"], div') || el
    const cs = getComputedStyle(box)
    return `${cs.color} on ${cs.backgroundColor}, role ${box.getAttribute('role') || '(none)'}`
  }).catch(() => '(not found)')
  note('I: how the message is styled', errBox)
  await page.screenshot({ path: `${SHOTS}/I1-invite-removed-409.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const stillRemoved = await page.locator('li', { hasText: SECOND }).filter({ hasText: 'Restore' }).count()
  grade(stillRemoved > 0, 'I: the member is still under Removed after the refused invite')

  // ===== M: Send email now (opened from the Invite confirmation) =====
  console.log('--- M: Send email now')
  await inviteBtn.first().click()
  await dlg.locator('input[placeholder="First name"]').fill('Renata')
  await dlg.locator('input[type="email"]').fill(THIRD)
  await dlg.getByRole('button', { name: 'Share', exact: true }).click()
  const sendBtn = page.getByRole('button', { name: `Send to ${THIRD}` })
  await sendBtn.first().waitFor({ timeout: 10000 }).catch(() => {})
  grade((await sendBtn.count()) > 0, 'M send-email: the invite confirmation offers "Send to <address>"')
  await page.screenshot({ path: `${SHOTS}/M-invite-confirmation.png` })
  if (await sendBtn.count()) {
    await sendBtn.first().click()
    await page.waitForTimeout(900)
    const open = await page.getByRole('dialog').count()
    const names = await page.getByRole('dialog').evaluateAll((ds) =>
      ds.map((d) => document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || d.getAttribute('aria-label')))
    note('M send-email: dialogs open at once after clicking Send to', `${open}: ${names.join(' | ')}`)
    await page.screenshot({ path: `${SHOTS}/M-send-email-now.png` })
    const top = page.getByRole('dialog').last()
    grade(/Send this email now\?/.test(names.join('|')), 'M send-email: the confirmation is named "Send this email now?"')
    grade(await top.evaluate((d) => d.contains(document.activeElement)), 'M send-email: focus is inside the confirmation', await focused())
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    const after = await page.getByRole('dialog').count()
    grade(after === open - 1, 'M send-email: one Escape closes only the confirmation',
      `${open} open before, ${after} after, focus ${await focused()}, url ${page.url().replace(BASE, '')}`)
    while (await page.getByRole('dialog').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }
  }

  // ===== M: Set password (user menu) =====
  console.log('--- M: Set password')
  // The project page has no user menu; the dashboard does.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const menu = page.locator('button[title="test@ibuild4you.com"]')
  await menu.first().click()
  await page.waitForTimeout(400)
  const item = page.getByRole('button', { name: /password/i })
  const itemText = squash(await item.first().innerText().catch(() => ''))
  await item.first().click()
  const pd = page.getByRole('dialog')
  await pd.first().waitFor({ timeout: 6000 }).catch(() => {})
  const pn = await pd.count()
  grade(pn === 1, `M set-password: one dialog opens from "${itemText}"`, `${pn}`)
  if (pn) {
    const name = await pd.first().evaluate((d) => document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || d.getAttribute('aria-label'))
    grade(!!name, 'M set-password: the dialog has a name', `"${name}"`)
    grade(await pd.first().evaluate((d) => d.contains(document.activeElement)), 'M set-password: focus is inside on open', await focused())
    await page.screenshot({ path: `${SHOTS}/M-set-password.png` })
    let escaped = 0
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab')
      if (!(await pd.first().evaluate((d) => d.contains(document.activeElement)).catch(() => false))) escaped++
    }
    grade(escaped === 0, 'M set-password: Tab stays inside (25 presses)', `${escaped} outside`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    grade((await page.getByRole('dialog').count()) === 0, 'M set-password: Escape closes it')
    // The opener is a menu item that is gone once the menu closes.
    note('M set-password: focus after close', await focused())
  }
} catch (e) {
  grade(false, `script error: ${String(e.message).split('\n')[0]}`)
  await page.screenshot({ path: `${SHOTS}/error.png` }).catch(() => {})
} finally {
  if (proj && auth) {
    const del = await page.request.delete(`${BASE}/api/projects?project_id=${proj.id}`, { headers: { authorization: auth } })
    console.log(`cleanup DELETE → ${del.status()}`)
  }
  await browser.close()
}
console.log(failures ? `FAILED: ${failures} check(s)` : 'PASS: all checks')
process.exit(failures ? 1 : 0)
