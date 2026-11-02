#!/usr/bin/env node
// #247 — a builder alone in a session gets the roster framing. Walk-through:
//   1. Throwaway brief with a maker participant (Dana) who never signs in.
//   2. The test admin (owner) posts a note through /api/chat with "Sam replies"
//      on, before the maker has spoken.
//   3. Sam's reply is printed for a human read: it should treat the note as the
//      builder's guidance (e.g. "I'll ask Dana…"), not answer as if Dana wrote it.
//   Graded mechanically: the turn streams (200) and the reply is non-empty.
// The throwaway brief is deleted at the end, pass or fail.
// Needs .ibuild4you-bypass + .test-admin-password. Calls the real model once.
// Usage: node scripts/e2e-247-builder-solo.mjs

import { launchLoggedIn, BASE } from './lib/preview-login.mjs'

const stamp = Math.floor(performance.now()).toString(36)
const TITLE = `E2E247 builder solo ${stamp} — delete me`

let failures = 0
const grade = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`)
  if (!ok) failures++
}

const { browser, page } = await launchLoggedIn()
let projectId = null
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

try {
  // Create through the Import JSON modal, which also captures the builder token.
  await page.getByRole('button', { name: 'New brief' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('#project-json').fill(JSON.stringify({
    _payload_type: 'new-project',
    title: TITLE,
    participants: [{ email: `dana-${stamp}@example.com`, first_name: 'Dana', role: 'maker' }],
    welcome_message: `Hi Dana, tell me about your dog-walking business.`,
    brief: { problem: 'Dog walkers cannot take bookings online', target_users: 'Local dog owners' },
  }))
  const respP = page
    .waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 })
    .catch(() => null)
  await page.getByRole('button', { name: 'Import & create' }).click()
  const resp = await respP
  if (!resp || resp.status() !== 201) throw new Error(`create failed: ${resp?.status()}`)
  const proj = await resp.json()
  projectId = proj.id
  auth = resp.request().headers()['authorization']
  console.log(`created ${proj.id} (${proj.slug})`)

  const sessions = await (await call('GET', `/api/sessions?project_id=${projectId}`)).json()
  const sessionId = sessions[0]?.id
  if (!sessionId) throw new Error('no session on the new brief')

  const note = 'When Dana arrives, ask her which days of the week she walks dogs, and whether she takes cats too.'
  console.log(`builder note: ${note}`)
  const chat = await call('POST', '/api/chat', { session_id: sessionId, content: note })
  const raw = await chat.text().catch(() => '')
  grade(chat.status() === 200, `POST /api/chat -> ${chat.status()}`)

  // Reassemble the SSE text deltas.
  const reply = raw
    .split('\n')
    .filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')
    .map((l) => {
      try { return JSON.parse(l.slice(6)).text || '' } catch { return '' }
    })
    .join('')
  grade(reply.trim().length > 0, 'Sam replied')
  console.log(`\n--- Sam's reply ---\n${reply}\n-------------------\n`)
} catch (e) {
  console.error(`FAIL: ${e.message}`)
  failures++
} finally {
  if (projectId && auth) {
    const del = await call('DELETE', `/api/projects?project_id=${projectId}`).catch((e) => ({ status: () => e.message }))
    console.log(`cleanup DELETE -> ${del.status()}`)
  }
  await browser.close()
}

console.log(failures === 0 ? 'ALL PASS (read the reply above)' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
