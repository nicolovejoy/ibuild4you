#!/usr/bin/env node
// #39 — smoke-test the prep-prompt split (commit 21f4c10) end-to-end on preview.
// Drives all eight queued cases through the real UI ferry: copy the prep prompt,
// (this script plays the Claude side and crafts the JSON), paste the payload
// back, and verify the dashboard accepts it and the next session snapshots the
// expected agent posture.
//
//  1. New-brief JSON import — empty brief, no prior sessions
//  2. Next-convo JSON for an existing project with 1+ sessions
//  3. Seed questions + directives populated
//  4. Empty seed questions + directives
//  5. discover mode
//  6. converge mode
//  7. builder identity set
//  8. Non-trivial brief.decisions (locked + provenance)
// Bonus (warn-only): live maker chat probe grading the custom-identity posture.
//
// Usage: node scripts/e2e-39-prep-smoke.mjs          (preview)
//        E2E_BASE=https://ibuild4you.com E2E_PASSWORD_FILE=.test-admin-password-prod \
//          node scripts/e2e-39-prep-smoke.mjs        (prod)

import { chromium } from 'playwright'
import { launchLoggedIn, readToken, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`${msg} ✓`)
const warn = (msg) => console.log(`WARN: ${msg}`)

const IDENTITY_V1 = 'You are Piper, a pragmatic intake assistant. Introduce yourself as Piper.'
const IDENTITY_V2 =
  'You are Piper, a pragmatic intake assistant. Introduce yourself as Piper and end every reply with exactly one focused question.'
const LOCKED_DECISION = { topic: 'Hosting', decision: 'Static site only — no server-side code', locked: true }

const { browser, ctx, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })

const openImportModal = async () => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Import JSON' }).click()
  await page.waitForTimeout(300)
}

const importCreate = async (payload) => {
  await page.locator('#project-json').fill(JSON.stringify(payload))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) return { error: `create → ${resp?.status()}` }
  const body = await resp.json()
  return { body, authHeader: resp.request().headers()['authorization'] }
}

const readClipboard = () => page.evaluate(() => navigator.clipboard.readText())
const api = (method, path, authHeader, data) =>
  page.request[method](`${BASE}${path}`, {
    headers: { authorization: authHeader, 'content-type': 'application/json' },
    ...(data ? { data: JSON.stringify(data) } : {}),
  })

// --- Prep-prompt copy: new-brief side ---
await openImportModal()
await page.getByRole('button', { name: 'Copy new-brief prep' }).click()
await page.waitForTimeout(300)
const newPrep = await readClipboard().catch(() => '')
if (!newPrep.startsWith('NEW-PROJECT PREP')) fail(`new-brief prep clipboard wrong: "${newPrep.slice(0, 60)}"`)
else ok('Copy new-brief prep copies the NEW-PROJECT prompt')

// --- Case 1: minimal import — empty brief, no prior sessions ---
const minimal = await importCreate({
  _payload_type: 'new-project',
  title: `E2E39 minimal ${stamp} — delete me`,
  requester_email: `e2e39-min-${stamp}@example.com`,
  requester_first_name: 'Riley',
})
if (minimal.error) { fail(`case 1 ${minimal.error}`); await browser.close(); process.exit() }
await page.waitForTimeout(1500)
{
  const sessions = await (await api('get', `/api/sessions?project_id=${minimal.body.id}`, minimal.authHeader)).json()
  const brief = await (await api('get', `/api/briefs?project_id=${minimal.body.id}`, minimal.authHeader)).json()
  if (!page.url().includes('/projects/')) fail(`case 1: didn't land on the project page: ${page.url()}`)
  else if (!Array.isArray(sessions) || sessions.length !== 1) fail(`case 1: expected 1 session, got ${sessions?.length}`)
  else if (brief !== null) fail('case 1: expected no brief on a brief-less import')
  else ok('case 1: minimal import accepted — 1 fresh session, no brief')
}

// --- Case 3/5/7/8 setup: maximal new-project import ---
const maxPayload = {
  _payload_type: 'new-project',
  title: `E2E39 maximal ${stamp} — delete me`,
  requester_email: `e2e39-max-${stamp}@example.com`,
  requester_first_name: 'Mara',
  session_mode: 'discover',
  seed_questions: ['What problem are you solving?', 'Who are your customers?'],
  builder_directives: ['Do not suggest technologies', 'Focus on the ordering workflow'],
  identity: IDENTITY_V1,
  welcome_message: `Hey Mara — tell me about the idea! (${stamp})`,
  brief: {
    problem: 'Customers cannot order online.',
    target_users: 'Local cafe customers.',
    features: ['Online ordering', 'Pickup scheduling'],
    constraints: 'Must work on mobile.',
    additional_context: '',
    decisions: [LOCKED_DECISION, { topic: 'Payments', decision: 'Cash and card at pickup' }],
    open_risks: ['pricing model undecided'],
  },
}
await openImportModal()
const maximal = await importCreate(maxPayload)
if (maximal.error) { fail(`maximal create ${maximal.error}`); await browser.close(); process.exit() }
const proj = maximal.body
const auth = maximal.authHeader
console.log(`created ${proj.id} (${proj.slug})`)
await page.waitForTimeout(1500)

const getSessions = async () => (await api('get', `/api/sessions?project_id=${proj.id}`, auth)).json()
const getBrief = async () => (await api('get', `/api/briefs?project_id=${proj.id}`, auth)).json()

{
  const [s1] = (await getSessions()).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  if (s1?.session_mode !== 'discover') fail(`case 5: session 1 snapshot mode = ${s1?.session_mode}`)
  else ok('case 5: discover mode snapshotted onto session 1')
  if (JSON.stringify(s1?.seed_questions) !== JSON.stringify(maxPayload.seed_questions) ||
      JSON.stringify(s1?.builder_directives) !== JSON.stringify(maxPayload.builder_directives))
    fail('case 3: seeds/directives missing from session 1 snapshot')
  else ok('case 3: populated seed questions + directives snapshotted')
  if (s1?.identity !== IDENTITY_V1) fail('case 7a: identity missing from session 1 snapshot')
  else ok('case 7a: builder identity snapshotted at create')

  const brief = await getBrief()
  const decisions = brief?.content?.decisions || []
  const locked = decisions.find((d) => d.topic === LOCKED_DECISION.topic)
  const payments = decisions.find((d) => d.topic === 'Payments')
  if (!locked?.locked || locked.decision !== LOCKED_DECISION.decision) fail('case 8a: locked decision not stored at create')
  else if (!payments?.decided_at) fail('case 8a: create-path provenance stamp (decided_at) missing')
  else ok('case 8a: decisions stored at create with provenance stamps')
}

// --- Prep-prompt copy: next-convo side ---
await page.goto(`${BASE}/projects/${proj.slug}?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /Copy next-convo prep/ }).click()
await page.waitForTimeout(1500)
const nextPrep = await readClipboard().catch(() => '')
if (!nextPrep.startsWith('NEXT-CONVO PREP')) fail(`next-convo prep clipboard wrong: "${nextPrep.slice(0, 60)}"`)
else if (!nextPrep.includes(maxPayload.title) || !nextPrep.includes(LOCKED_DECISION.decision))
  fail('next-convo prep missing project title or current brief content')
else ok('Copy next-convo prep copies prompt + live project state')

// --- Synthetic maker reply so dispatch state = start ---
const [s1] = (await getSessions()).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
const synth = await api('post', '/api/admin/sessions', auth, {
  project_id: proj.id,
  op: 'add_synthetic_message',
  session_id: s1.id,
  role: 'user',
  content: 'I want converge next time. Also: payments should be Stripe only. (synthetic, e2e #39)',
})
if (synth.status() !== 200) { fail(`add_synthetic_message → ${synth.status()}`); await browser.close(); process.exit() }

// --- Case 2/4/6/7/8: next-convo payload paste ---
const carried = (await getBrief()).content.decisions.find((d) => d.topic === 'Payments')
const nextConvo = {
  _payload_type: 'next-convo',
  brief: {
    ...maxPayload.brief,
    problem: 'Customers cannot order online; converging on scope.',
    decisions: [
      LOCKED_DECISION, // carried verbatim per prompt rules
      carried, // unchanged, stamps riding along
      { topic: 'Payment processor', decision: 'Stripe only' }, // new this round
    ],
    open_risks: [],
  },
  session_mode: 'converge',
  seed_questions: [],
  builder_directives: [],
  identity: IDENTITY_V2,
  welcome_message: `Welcome back Mara — let's lock scope. (${stamp})`,
}
await page.getByPlaceholder(/next-convo/).fill(JSON.stringify(nextConvo))
await page.getByRole('button', { name: 'Import JSON' }).click()
await page.waitForTimeout(3000)

if (page.url().includes('tab=brief')) fail(`case 2: import didn't hand off to Conversations: ${page.url()}`)
else ok('case 2: next-convo import accepted, handed off to Conversations')
const dialog = page.getByRole('dialog')
if (!(await dialog.count())) fail('case 2: Start modal did not auto-open in start state')
else {
  const text = (await dialog.innerText()).replace(/\s+/g, ' ')
  if (!text.includes('Payload loaded')) fail('case 2: "Payload loaded" line missing from Start modal')
  else ok('case 2: Start modal auto-opened with "Payload loaded"')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
}

// --- Start conversation 2 via the product API (email fan-out is #115-verified) ---
const s2resp = await api('post', '/api/sessions', auth, { project_id: proj.id })
if (s2resp.status() !== 201) { fail(`POST /api/sessions → ${s2resp.status()}`); await browser.close(); process.exit() }
const s2 = await s2resp.json()
{
  if (s2.session_mode !== 'converge') fail(`case 6: session 2 snapshot mode = ${s2.session_mode}`)
  else ok('case 6: converge mode snapshotted onto session 2')
  if (!Array.isArray(s2.seed_questions) || s2.seed_questions.length !== 0 ||
      !Array.isArray(s2.builder_directives) || s2.builder_directives.length !== 0)
    fail('case 4: empty seeds/directives did not land as empty arrays')
  else ok('case 4: empty seed questions + directives accepted and snapshotted')
  if (s2.identity !== IDENTITY_V2) fail('case 7b: updated identity missing from session 2 snapshot')
  else ok('case 7b: next-convo identity update snapshotted')

  const brief = await getBrief()
  const decisions = brief?.content?.decisions || []
  const locked = decisions.find((d) => d.topic === LOCKED_DECISION.topic)
  const kept = decisions.find((d) => d.topic === 'Payments')
  const fresh = decisions.find((d) => d.topic === 'Payment processor')
  if (!locked?.locked || locked.decision !== LOCKED_DECISION.decision) fail('case 8b: locked decision lost on next-convo import')
  else if (!fresh?.decided_at) fail('case 8b: new decision not provenance-stamped on import')
  else if (kept?.decided_at !== carried?.decided_at) fail('case 8b: carried decision stamp changed on import')
  else ok('case 8b: locked survived verbatim, new decision stamped, carried stamps unchanged')
}

// --- Bonus (warn-only): live maker probe of the custom-identity posture ---
const makerCreds = (proj.members || []).find((m) => m.email === maxPayload.requester_email)
if (!makerCreds?.passcode) warn('no maker passcode in create response — skipping live posture probe')
else {
  const mctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const mpage = await mctx.newPage()
  try {
    await mpage.goto(
      `${BASE}/projects/${proj.slug}?x-vercel-protection-bypass=${readToken()}&x-vercel-set-bypass-cookie=true`,
      { waitUntil: 'domcontentloaded' },
    )
    await mpage.waitForTimeout(1500)
    if (mpage.url().includes('/auth/login')) {
      await mpage.locator('#email').fill(maxPayload.requester_email)
      await mpage.locator('#passcode').fill(makerCreds.passcode)
      await mpage.getByRole('button', { name: 'Sign in with passcode' }).click()
      await mpage.waitForTimeout(2500)
      if (!mpage.url().includes('/projects/')) {
        await mpage.goto(`${BASE}/projects/${proj.slug}`, { waitUntil: 'domcontentloaded' })
        await mpage.waitForTimeout(2000)
      }
    }
    // First-visit gate: new makers are asked for a display name before the chat.
    if ((await mpage.locator('body').innerText()).includes('What should we call you?')) {
      await mpage.locator('input:visible').first().fill('Mara')
      await mpage.getByRole('button', { name: 'Continue' }).click()
      await mpage.waitForTimeout(2500)
    }
    const box = mpage.getByPlaceholder('Type a message...')
    await box.waitFor({ timeout: 15000 })
    await box.fill('Quick check before we start: who am I talking to, and what are we doing today?')
    await box.press('Enter')
    await mpage.waitForTimeout(18000)
    // Maker chat renders newest-first — the reply is at the head of main.
    const head = (await mpage.locator('main').innerText().catch(() => '')).slice(0, 1500)
    if (/piper/i.test(head)) ok('posture probe: agent speaks as the custom identity (Piper)')
    else warn(`posture probe: no "Piper" in reply head — inspect manually:\n${head.slice(0, 400)}`)
  } catch (e) {
    warn(`posture probe errored (${e.message}) — non-blocking`)
  }
  await mctx.close()
}

// --- Cleanup ---
for (const id of [minimal.body.id, proj.id]) {
  const del = await api('delete', `/api/projects?project_id=${id}`, auth)
  console.log(`cleanup DELETE ${id} → ${del.status()}`)
}

await browser.close()
console.log(process.exitCode ? 'FAILED' : 'PASS: all 8 prep-prompt smoke cases verified')
