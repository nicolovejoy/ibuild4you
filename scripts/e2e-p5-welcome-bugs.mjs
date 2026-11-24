#!/usr/bin/env node
// Project 5 (welcome bugs), checked on preview with a throwaway brief and a
// test-cast maker. Graded, nothing adjusted to pass.
//
//   A (bug 1)  An import with a new welcome into an open conversation whose
//              welcome the maker has not answered leaves exactly one welcome:
//              the new one, tagged kind 'welcome'.
//   B (bug 2)  The maker speaks, the kickoff posts the canned greeting, a
//              pasted payload posts a new welcome W3 into that conversation.
//              The builder's Conversations header then offers Nudge (not
//              "Start conversation 2") and the Start modal does not open by
//              itself; the paste banner says the config was applied to the
//              open conversation. Sam's earlier reply and the maker's message
//              stay. The last reminder beside Nudge: "No reminder sent since
//              the welcome was posted.", then the copied wording with a
//              Pacific time (still there after a reload), then, after "Send
//              reminder" (to the test-cast address), the emailed wording on the
//              header and on the dashboard card. POST /api/sessions as the
//              builder then opens conversation 2 with W3. After the maker
//              answers, the header shows Start and the Start modal's
//              "Opens with" line shows the next welcome.
//   E (bug 2)  Stale cache: the builder opens Conversations first (messages are
//              cached in the page), switches to Brief without a reload, imports
//              the payload with a welcome; no Start dialog appears at any point
//              while the hand-off happens and the header ends on Nudge.
//   F          Email then copy: after Send reminder, Copy reminder shows both
//              sentences, the emailed one (with the address) first and the
//              copied one after it, on the page and after a reload.
//   G          After the import the reminders strip does not say "paused (maker
//              replied)" and the turn badge says waiting on the maker, on the
//              project page and on the dashboard card. Auto reminders are turned
//              on for the throwaway brief so the strip is not just "Reminders off".
//
// The maker is a test-cast identity (the kickoff is maker-only and the test
// admin resolves to owner; docs/runbooks.md, agent-driven e2e). Needs
// .test-cast-passwords.json, otherwise prints SKIPPED and exits 0. Preview has
// FEEDBACK_NOTIFY_SUPPRESS on. Headless Chromium only. Screenshots go to
// E2E_SHOT_DIR (default: the harness's shotDir).
// Usage: node scripts/e2e-p5-welcome-bugs.mjs

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
const W1 = `e2e W1 hello ${stamp}.`
const W2 = `e2e W2 replacement welcome ${stamp}.`
const W3 = `e2e W3 round-two welcome ${stamp}.`
const W4 = `e2e W4 next round welcome ${stamp}.`
const BRIEF = { problem: 'Customers cannot book online.', target_users: 'Local dog owners.', features: ['Online booking'] }

let failures = 0
const grade = (ok, label, evidence) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${evidence ? `  [${evidence}]` : ''}`)
  if (!ok) failures++
}
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim()

const { browser, ctx, page } = await launchLoggedIn()
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {})
const created = [] // { id, auth }

// Errors are cut to their first line: Playwright's full error echoes headers.
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

// Create a brief through the dashboard Import JSON modal; returns the project
// and the builder's Bearer token.
async function createBrief(title, welcome) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title,
    requester_email: MAKER,
    requester_first_name: 'Mara',
    welcome_message: welcome,
    brief: BRIEF,
  }))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  const proj = await resp.json()
  const auth = resp.request().headers()['authorization']
  created.push({ id: proj.id, auth })
  console.log(`created ${proj.id} (${proj.slug}) "${title}"`)
  return { proj, auth }
}

const bGet = async (auth, path) => (await call(page, auth, 'GET', path)).json()
const msgsOf = async (auth, sid) => {
  const m = await bGet(auth, `/api/messages?session_id=${sid}`)
  return Array.isArray(m) ? m : []
}
const sessionsOf = async (auth, projectId) => {
  const s = await bGet(auth, `/api/sessions?project_id=${projectId}`)
  return (Array.isArray(s) ? s : []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}
const getProject = (auth, slug) => bGet(auth, `/api/projects?slug=${slug}`)
const agentMsgs = (msgs) => msgs.filter((m) => m.role === 'agent')

// Pacific date-time the way the app prints it: "November 23, 2:10 PM".
const pacific = (d) => {
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(d)
  return squash(`${date}, ${time}`)
}

// Maker: sign in on a project's chat, get past the name prompt, send one
// message, wait for Sam's reply (agent messages in the session grow by one).
async function makerSession(slug) {
  const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const mpage = await mctx.newPage()
  const m = { ctx: mctx, page: mpage, auth: null }
  mpage.on('request', (r) => {
    const a = r.headers()['authorization']
    if (a && r.url().includes('/api/')) m.auth = a
  })
  await loginWithPassword(mpage, { email: MAKER, password: readCastPassword(MAKER), path: `/projects/${slug}` })
  return m
}
async function makerSays(m, text, { auth, sessionId }) {
  const box = m.page.getByPlaceholder('Type a message...')
  for (let i = 0; i < 20; i++) {
    if (await box.isVisible().catch(() => false)) break
    if ((await m.page.locator('body').innerText().catch(() => '')).includes('What should we call you?')) {
      await m.page.locator('input:visible').first().fill('Mara')
      await m.page.getByRole('button', { name: 'Continue' }).click()
    }
    await m.page.waitForTimeout(2000)
  }
  if (!(await box.isVisible().catch(() => false))) throw new Error('maker composer never appeared')
  const before = agentMsgs(await msgsOf(auth, sessionId)).length
  await box.fill(text)
  await box.press('Control+Enter')
  for (let i = 0; i < 40; i++) {
    await m.page.waitForTimeout(2000)
    const now = await msgsOf(auth, sessionId)
    if (agentMsgs(now).length > before && now.some((x) => x.role === 'user' && x.content === text)) return
  }
  throw new Error('Sam never replied to the maker message')
}

async function pasteOnBriefTab(slug, json) {
  await page.goto(`${BASE}/projects/${slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.getByPlaceholder(/prep chat/).fill(JSON.stringify(json))
  await page.getByRole('button', { name: 'Import JSON' }).click()
  await page.waitForTimeout(3500)
  // A paste not made from a prep shows a note first; "Continue" hands off.
  const cont = page.getByRole('button', { name: 'Continue to Conversations' })
  if (await cont.isVisible().catch(() => false)) {
    await cont.click()
    await page.waitForTimeout(2500)
  }
}

// Stale cache: open Conversations first so its messages are cached in the page,
// switch to the Brief tab with no reload, paste, and watch for a Start dialog
// the whole time the import hands off. Returns what was seen.
async function pasteWithStaleCache(slug, json) {
  await page.goto(`${BASE}/projects/${slug}?tab=conversations`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  const cachedText = await mainText()
  const loaded = /dog-walking/.test(cachedText)
  await page.screenshot({ path: `${SHOTS}/E0-conversations-before-import.png`, fullPage: true })
  await page.locator('nav button:visible', { hasText: /^\s*Brief\s*$/ }).first().click()
  await page.waitForTimeout(1500)
  // Brief is the default tab, so its URL carries no ?tab=: the paste box is the sign.
  const onBrief = await page.getByPlaceholder(/prep chat/).isVisible().catch(() => false)
  await page.getByPlaceholder(/prep chat/).fill(JSON.stringify(json))
  await page.getByRole('button', { name: 'Import JSON' }).click()
  // Poll 12 seconds in 250 ms steps: click "Continue" when it shows, and look for
  // any dialog on every step.
  const dialogs = []
  let clicked = false
  const t0 = Date.now()
  for (let i = 0; i < 48; i++) {
    const dlg = page.getByRole('dialog')
    if ((await dlg.count().catch(() => 0)) > 0) {
      const seen = `+${Date.now() - t0} ms, continue clicked ${clicked}, url ${page.url().replace(/^[^?]*/, '') || '(no query)'}: ${squash(await dlg.first().innerText().catch(() => '')).slice(0, 100)}`
      if (dialogs.length === 0) await page.screenshot({ path: `${SHOTS}/E1-dialog-seen.png`, fullPage: true })
      dialogs.push(seen)
    }
    const cont = page.getByRole('button', { name: 'Continue to Conversations' })
    if (!clicked && (await cont.isVisible().catch(() => false))) {
      await cont.click().catch(() => {})
      clicked = true
    }
    await page.waitForTimeout(250)
  }
  return { loaded, onBrief, dialogs }
}
const mainText = async (pg = page) => squash(await pg.locator('main').innerText().catch(() => ''))

try {
  // ===== Scenario A: bug 1 =====
  console.log('--- A: an import replaces an unanswered welcome')
  {
    const { proj, auth } = await createBrief(`e2e welcome-bugs A ${stamp} — delete me`, W1)
    const [s1] = await sessionsOf(auth, proj.id)
    const before = await msgsOf(auth, s1.id)
    grade(agentMsgs(before).length === 1 && before[0].content === W1, 'A: conversation 1 opens with W1', `${agentMsgs(before).length} agent message(s)`)
    const patch = await call(page, auth, 'PATCH', '/api/projects', {
      project_id: proj.id,
      payload_pasted_at: new Date().toISOString(),
      welcome_message: W2,
    })
    grade(patch.status() === 200, 'A: PATCH import', `status ${patch.status()}`)
    const after = await msgsOf(auth, s1.id)
    const ag = agentMsgs(after)
    grade(ag.length === 1 && ag[0].content === W2 && ag[0].kind === 'welcome',
      'A: exactly one welcome, the new one, kind welcome',
      `${ag.length} agent message(s): ${ag.map((m) => `"${squash(m.content).slice(0, 30)}" kind=${m.kind}`).join(' | ')}`)
    grade(!ag.some((m) => m.content === W1), 'A: the old welcome W1 is gone')
  }

  // ===== Scenario B: bug 2, banner, reminder line =====
  console.log('--- B: maker spoke, kickoff greeting, import posts a welcome')
  const { proj, auth } = await createBrief(`e2e welcome-bugs B ${stamp} — delete me`, W1)
  const [s1] = await sessionsOf(auth, proj.id)
  const arOn = await call(page, auth, 'PATCH', '/api/projects', { project_id: proj.id, auto_reminders_enabled: true })
  grade(arOn.status() === 200, 'G: PATCH auto_reminders_enabled (setup, so the strip is not just "Reminders off")', `status ${arOn.status()}`)
  const maker = await makerSession(proj.slug)
  await makerSays(maker, 'I want a booking page for my dog-walking service.', { auth, sessionId: s1.id })
  const afterChat = await msgsOf(auth, s1.id)
  const samReply = agentMsgs(afterChat).find((m) => m.content !== W1)
  grade(!!samReply, 'B: maker spoke and Sam replied in conversation 1')

  // The maker has been away: mark the prep copied, then the maker's kickoff.
  const prep = await call(page, auth, 'PATCH', '/api/projects', { project_id: proj.id, prep_copied_at: new Date().toISOString() })
  grade(prep.status() === 200, 'B: PATCH prep_copied_at', `status ${prep.status()}`)
  const ko = await call(maker.page, maker.auth, 'POST', '/api/chat/kickoff', { session_id: s1.id })
  await ko.text().catch(() => '')
  const afterKo = await msgsOf(auth, s1.id)
  const greetings = afterKo.filter((m) => m.kind === 'unqueued_greeting')
  grade(greetings.length === 1, 'B: kickoff posted one canned greeting', `kickoff ${ko.status()}, ${greetings.length} greeting(s)`)

  // The builder pastes a next-convo payload with W3, through the real paste box.
  const stale = await pasteWithStaleCache(proj.slug, {
    _payload_type: 'next-convo',
    welcome_message: W3,
    brief: { ...BRIEF, problem: `Round two ${stamp}` },
  })
  grade(stale.loaded && stale.onBrief, 'E: Conversations was open with its messages loaded, then Brief opened without a reload',
    `messages shown ${stale.loaded}, on Brief tab ${stale.onBrief}`)
  grade(stale.dialogs.length === 0, 'E: no dialog appeared at any point during the import and hand-off (12 s, every 250 ms)',
    stale.dialogs.length ? `seen: ${stale.dialogs[0]}` : 'none seen')
  grade(!page.url().includes('tab=brief'), 'B: the import hands off to Conversations', page.url().replace(/\?.*/, ''))
  const afterImport = await msgsOf(auth, s1.id)
  const lastAgent = agentMsgs(afterImport).slice(-1)[0]
  grade(!afterImport.some((m) => m.kind === 'unqueued_greeting'), 'B: the canned greeting is gone')
  grade(afterImport.some((m) => m.role === 'user' && /dog-walking/.test(m.content)) && afterImport.some((m) => m.id === samReply?.id),
    "B: the maker's message and Sam's reply are still there")
  grade(lastAgent?.content === W3 && lastAgent?.kind === 'welcome', 'B: last agent message is W3, kind welcome',
    `"${squash(lastAgent?.content).slice(0, 40)}" kind=${lastAgent?.kind}`)

  const text1 = await mainText()
  await page.screenshot({ path: `${SHOTS}/B1-after-import-nudge-state.png`, fullPage: true })
  const nudgeBtn = await page.getByRole('button', { name: /^Nudge/ }).count()
  const startBtn = await page.getByRole('button', { name: /Start conversation 2/ }).count()
  grade(nudgeBtn > 0 && startBtn === 0, 'B: header shows Nudge, not "Start conversation 2"', `Nudge buttons ${nudgeBtn}, Start buttons ${startBtn}`)
  grade((await page.getByRole('dialog').count()) === 0, 'B: no Start window opened by itself')
  grade(nudgeBtn > 0 && startBtn === 0, 'E: after the stale-cache import the header ends on Nudge', `Nudge buttons ${nudgeBtn}, Start buttons ${startBtn}`)
  const strip = await page.locator('span', { hasText: /^Reminders (on|off)/ }).first().innerText().catch(() => '(strip not found)')
  grade(strip !== '(strip not found)' && !/paused \(maker replied\)/.test(strip) && !/maker replied/i.test(strip),
    'G: the reminders strip does not say "paused (maker replied)"', `strip: "${squash(strip)}"`)
  const badge = text1.match(/Waiting on \w+|Your turn|Maker waiting[^.]{0,30}|Waiting for builder|Needs setup/)?.[0]
  grade(badge === 'Waiting on Mara', 'G: the turn badge on the project page says waiting on the maker', `badge: "${badge}"`)
  const bannerMatch = text1.match(/Payload loaded\.[^]*?(?= Dismiss|$)/)
  const banner = bannerMatch ? bannerMatch[0].slice(0, 140) : '(no banner)'
  grade(/Payload loaded\./.test(text1) && /applied to the open conversation/.test(text1) && !/from the next conversation/.test(text1),
    'C: paste banner (open conversation, maker has not answered the welcome)', banner)

  // Reminder line: nothing sent yet.
  const NONE = 'No reminder sent since the welcome was posted.'
  grade(text1.includes(NONE), 'D: reminder line says nothing was sent', text1.match(/No reminder[^.]*\./)?.[0] || '(not found)')

  // Copy reminder.
  await page.getByRole('button', { name: /^Nudge/ }).first().click()
  await page.waitForTimeout(600)
  const modalText = squash(await page.getByRole('dialog').innerText().catch(() => ''))
  const shown = await page.getByRole('dialog').locator('textarea').inputValue().catch(() => '')
  const copyAt = new Date()
  await page.getByRole('button', { name: 'Copy reminder' }).click()
  await page.waitForTimeout(2500)
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `(clipboard read failed: ${String(e.message).split('\n')[0]})`)
  grade(clip === shown && clip.length > 0, 'D: Copy reminder put the reminder text on the clipboard', `"${squash(clip).slice(0, 60)}"`)
  await page.screenshot({ path: `${SHOTS}/B2-copy-reminder-modal.png`, fullPage: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  const copiedRe = (d) => `Reminder text copied ${pacific(d)}. The app did not send it.`
  const okCopied = (t) => [copyAt, new Date(copyAt.getTime() - 60000), new Date(copyAt.getTime() + 60000)].some((d) => t.includes(copiedRe(d)))
  const text2 = await mainText()
  grade(okCopied(text2), 'D: line reads the copied wording with a Pacific time', text2.match(/Reminder text copied[^]*?send it\./)?.[0] || '(not found)')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const text3 = await mainText()
  grade(okCopied(text3), 'D: the copied line is still there after a reload', text3.match(/Reminder text copied[^]*?send it\./)?.[0] || '(not found)')
  await page.screenshot({ path: `${SHOTS}/B3-copied-after-reload.png`, fullPage: true })

  // Send reminder (to the test-cast maker address).
  await page.getByRole('button', { name: /^Nudge/ }).first().click()
  await page.waitForTimeout(600)
  const sendAt = new Date()
  await page.getByRole('button', { name: 'Send reminder' }).click()
  await page.waitForTimeout(5000)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const emailedRe = (d) => `Reminder emailed to ${MAKER}, ${pacific(d)}.`
  const okEmailed = (t) => [sendAt, new Date(sendAt.getTime() - 60000), new Date(sendAt.getTime() + 60000)].some((d) => t.includes(emailedRe(d)))
  const text4 = await mainText()
  grade(okEmailed(text4), 'D: after Send reminder the line reads "Reminder emailed to <maker>, <time>."',
    text4.match(/Reminder emailed to[^]*?\d{4}? ?[AP]M\./)?.[0] || text4.match(/Reminder[^.]*\./)?.[0] || '(not found)')
  grade((await page.getByRole('button', { name: /^Nudge/ }).count()) > 0, 'D: the Nudge button stays after a send')
  await page.screenshot({ path: `${SHOTS}/B4-emailed-after-reload.png`, fullPage: true })
  const pr = await getProject(auth, proj.slug)
  grade(pr.last_nudged_method === 'email' && Array.isArray(pr.last_nudged_to) && pr.last_nudged_to.includes(MAKER),
    'D: project stores last_nudged_method email and last_nudged_to', `${pr.last_nudged_method} / ${JSON.stringify(pr.last_nudged_to)}`)

  // Dashboard card.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const dash = squash(await page.locator('body').innerText().catch(() => ''))
  grade(okEmailed(dash), 'D: the dashboard card shows the same emailed sentence')
  await page.screenshot({ path: `${SHOTS}/B5-dashboard.png`, fullPage: false })
  const card = await page.evaluate((title) => {
    const re = /Waiting on [^\n]+|Your turn|Maker waiting[^\n]*|Waiting for builder|Needs setup|Completed/
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walk.nextNode())) {
      if (!n.textContent.includes(title)) continue
      for (let el = n.parentElement; el && el !== document.body; el = el.parentElement) {
        const m = el.innerText.match(re)
        if (m) return { turn: m[0].trim(), card: el.innerText.replace(/\s+/g, ' ').slice(0, 160) }
      }
    }
    return null
  }, `e2e welcome-bugs B ${stamp}`)
  grade(card?.turn === 'Waiting on Mara', 'G: the turn badge on the dashboard card says waiting on the maker', card ? `badge: "${card.turn}" in "${card.card}"` : '(card not found)')

  // F: email then copy. The last reminder was emailed above; now copy one.
  await page.goto(`${BASE}/projects/${proj.slug}?tab=conversations`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  await page.getByRole('button', { name: /^Nudge/ }).first().click()
  await page.waitForTimeout(600)
  const copyAt2 = new Date()
  await page.getByRole('button', { name: 'Copy reminder' }).click()
  await page.waitForTimeout(2500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  const both = (t) => {
    const e = [sendAt, new Date(sendAt.getTime() - 60000), new Date(sendAt.getTime() + 60000)].map(emailedRe).map((x) => t.indexOf(x)).filter((i) => i >= 0)
    const c = [copyAt2, new Date(copyAt2.getTime() - 60000), new Date(copyAt2.getTime() + 60000)].map(copiedRe).map((x) => t.indexOf(x)).filter((i) => i >= 0)
    return e.length > 0 && c.length > 0 && Math.min(...e) < Math.min(...c)
  }
  const bothEv = (t) => t.match(/Reminder emailed to[^]*?send it\./)?.[0] || '(not found)'
  const text6 = await mainText()
  await page.screenshot({ path: `${SHOTS}/F1-email-then-copy.png`, fullPage: true })
  grade(both(text6), 'F: after email then copy the line shows the emailed sentence (with the address) first, then the copied one', bothEv(text6))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  const text7 = await mainText()
  await page.screenshot({ path: `${SHOTS}/F2-email-then-copy-after-reload.png`, fullPage: true })
  grade(both(text7), 'F: both sentences are still there, in that order, after a reload', bothEv(text7))

  // POST /api/sessions as the builder anyway: conversation 2 opens with W3.
  const s2res = await call(page, auth, 'POST', '/api/sessions', { project_id: proj.id })
  grade(s2res.status() === 201, 'B: POST /api/sessions', `status ${s2res.status()}`)
  const s2 = await s2res.json()
  const s2msgs = await msgsOf(auth, s2.id)
  const s2first = agentMsgs(s2msgs)[0]
  grade(s2first?.content === W3, "B: conversation 2's first agent message is W3", `"${squash(s2first?.content).slice(0, 40)}"`)

  // The maker answers the welcome in conversation 2: the header shows Start.
  await maker.page.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
  await maker.page.waitForTimeout(3000)
  await makerSays(maker, 'Yes, that is what I meant.', { auth, sessionId: s2.id })
  await page.goto(`${BASE}/projects/${proj.slug}?tab=conversations`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  await page.screenshot({ path: `${SHOTS}/B6-after-maker-answers-start.png`, fullPage: true })
  const startNow = await page.getByRole('button', { name: /Start conversation 3/ }).count()
  const nudgeNow = await page.getByRole('button', { name: /^Nudge/ }).count()
  grade(startNow > 0 && nudgeNow === 0, 'B: after the maker answers, the header shows Start conversation 3 (no Nudge)', `Start ${startNow}, Nudge ${nudgeNow}`)
  const text5 = await mainText()
  grade(!text5.includes(NONE), 'D: no "No reminder sent" line in the Start state with no reminder for this conversation')

  // Second paste in the Start state: the modal opens and says what will open the conversation.
  await pasteOnBriefTab(proj.slug, {
    _payload_type: 'next-convo',
    welcome_message: W4,
    brief: { ...BRIEF, problem: `Round three ${stamp}` },
  })
  const dlg = page.getByRole('dialog')
  const dlgText = squash(await dlg.innerText().catch(() => ''))
  await page.screenshot({ path: `${SHOTS}/B7-start-modal-after-paste.png`, fullPage: true })
  grade((await dlg.count()) > 0 && /Start conversation 3/.test(dlgText), 'C: in the Start state the paste opens the Start modal', dlgText.slice(0, 80))
  grade(/Opens with/.test(dlgText) && dlgText.includes(W4), 'C: the modal\'s "Opens with" line shows the new welcome W4',
    dlgText.match(/Opens with[^]{0,80}/)?.[0] || '(no Opens with)')
  const dlgMsgs = await msgsOf(auth, s2.id)
  grade(agentMsgs(dlgMsgs).filter((m) => m.kind === 'welcome').length === 0 && agentMsgs(dlgMsgs).some((m) => m.content === W3),
    'B: the answered conversation 2 keeps its W3 and gets no new welcome from the second import')
  await page.keyboard.press('Escape')

  await maker.ctx.close()
} catch (e) {
  console.error(`FAIL: ${String(e.message).split('\n')[0]}`)
  failures++
} finally {
  for (const c of created) {
    const del = await call(page, c.auth, 'DELETE', `/api/projects?project_id=${c.id}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE ${c.id} -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
