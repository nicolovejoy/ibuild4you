#!/usr/bin/env node
// Verify PR #204 (welcome posted word for word on return sessions) and probe
// one PR #205 prompt rule on preview, end to end through the deployed API:
//   1. First conversation opens with the welcome verbatim.
//   2. A return conversation with a NEW welcome opens with it verbatim.
//   3. A return conversation with an UNCHANGED welcome opens empty.
//   4. Probe (LLM, reported not asserted): a third-person seed question is
//      put to the maker as "you".
// Creates a throwaway brief via Import JSON and deletes it at the end.

import { chromium } from 'playwright'
import { loginPage, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const W1 = `Round one hello ${stamp}.`
const W2 = `Round two ${stamp}: try https://example.com/app on your phone, then tell me pass or fail.`

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1 }
const pass = (msg) => console.log(`PASS: ${msg}`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
await loginPage(page)

// Create the brief through the Import JSON modal and capture the Bearer header.
await page.getByRole('button', { name: 'New brief' }).first().click()
await page.waitForTimeout(400)
await page.locator('#project-json').fill(JSON.stringify({
  _payload_type: 'new-project',
  title: `Welcome verbatim e2e ${stamp}`,
  welcome_message: W1,
}))
const respP = page
  .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
  .catch(() => null)
await page.getByRole('button', { name: 'Import & create' }).click()
const resp = await respP
if (!resp || resp.status() !== 201) {
  fail(`create failed: ${resp?.status()}`)
  await browser.close()
  process.exit()
}
const project = await resp.json()
const projectId = project.id
const headers = { authorization: resp.request().headers()['authorization'], 'content-type': 'application/json' }
// Errors are reduced to their first line: Playwright's full error log echoes
// the request headers, which carry the Bearer token and the bypass cookie.
const api = (method, path, data) =>
  page.request
    .fetch(`${BASE}${path}`, { method, headers, data: data ? JSON.stringify(data) : undefined })
    .catch((e) => {
      throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`)
    })

async function messagesOf(sessionId) {
  const r = await api('GET', `/api/messages?session_id=${sessionId}`)
  return r.json()
}
async function newSession() {
  const r = await api('POST', '/api/sessions', { project_id: projectId })
  if (r.status() !== 201) throw new Error(`POST /api/sessions → ${r.status()}`)
  return (await r.json()).id
}

try {
  // 1. First conversation.
  const sessions = await (await api('GET', `/api/sessions?project_id=${projectId}`)).json()
  const first = await messagesOf(sessions[0].id)
  if (first.length === 1 && first[0].role === 'agent' && first[0].content === W1) pass('first conversation opens with the welcome verbatim')
  else fail(`first conversation: ${JSON.stringify(first.map((m) => [m.role, m.content]))}`)

  // 2. Return conversation with a new welcome.
  await api('PATCH', '/api/projects', { project_id: projectId, welcome_message: W2 })
  const s2 = await newSession()
  const second = await messagesOf(s2)
  if (second.length === 1 && second[0].content === W2) pass('return conversation with a new welcome opens with it verbatim (URL intact)')
  else fail(`return/new welcome: ${JSON.stringify(second.map((m) => [m.role, m.content]))}`)

  // 3. Return conversation, welcome unchanged.
  const s3 = await newSession()
  const third = await messagesOf(s3)
  if (third.length === 0) pass('return conversation with an unchanged welcome opens empty (kickoff greets)')
  else fail(`return/unchanged welcome: ${JSON.stringify(third.map((m) => [m.role, m.content]))}`)

  // 4. Probe: third-person seed question addressed as "you".
  await api('PATCH', '/api/projects', {
    project_id: projectId,
    seed_questions: ['Where does he keep his saved spots today: only on his phone, or somewhere else too?'],
    builder_directives: ['Ask the seed question in your first reply.'],
  })
  const s4 = await newSession()
  const chat = await api('POST', '/api/chat', { session_id: s4, content: "Hi, I'm ready." })
  console.log(`POST /api/chat → ${chat.status()}`)
  const reply = (await messagesOf(s4)).filter((m) => m.role === 'agent').pop()?.content ?? ''
  console.log(`PROBE reply:\n  ${reply.replace(/\n/g, '\n  ')}`)
  const thirdPerson = /\b(he|his|him)\b/i.test(reply)
  console.log(thirdPerson ? 'PROBE: reply still uses he/his/him — check it' : 'PROBE: reply addresses the maker as "you"')
} catch (e) {
  fail(e.message)
} finally {
  const del = await api('DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
  console.log(`cleanup DELETE → ${del.status()}`)
  await browser.close()
}
