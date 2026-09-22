#!/usr/bin/env node
// Live smoke test for the stars-demo <-> ibuild4you server-to-server API
// (contract docs/specs/08a-ibuild4you-contract.md in the stars-demo repo).
// Runs the "Manual checklist requiring live Firestore" from spec 08 against
// a real deployment, using one synthetic cast of three participants.
//
// Env:
//   E2E_BASE                   default https://preview.ibuild4you.com
//   STARS_INTEGRATION_SECRET   required; the shared X-Integration-Secret value
//
// Flags:
//   --allow-prod        allow running against a production host
//                        (ibuild4you.com / www.ibuild4you.com); refused otherwise
//   --namespace-erase   also run the namespace-erase check at the end (never
//                        runs on a prod host, flag or not)
//
// Files (gitignored, optional):
//   .ibuild4you-bypass   Vercel Protection Bypass token, read from the repo
//                        root; sent as x-vercel-protection-bypass when present
//
// Usage:
//   STARS_INTEGRATION_SECRET=... node scripts/smoke-stars-integration.mjs
//   STARS_INTEGRATION_SECRET=... node scripts/smoke-stars-integration.mjs --namespace-erase
//
// Never prints the secret or the bypass token: every printed line goes
// through redact(), which replaces the secret value with [secret].
// Only synthetic labels/bodies are sent — no real names, emails or content.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname

const args = process.argv.slice(2)
const ALLOW_PROD = args.includes('--allow-prod')
const NAMESPACE_ERASE_FLAG = args.includes('--namespace-erase')

const BASE = process.env.E2E_BASE || 'https://preview.ibuild4you.com'
const SECRET = process.env.STARS_INTEGRATION_SECRET

// --- redaction: every printed line goes through this ---

function redact(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  return SECRET ? str.split(SECRET).join('[secret]') : str
}
function log(value) {
  console.log(redact(value))
}

if (!SECRET) {
  log('Missing required env var STARS_INTEGRATION_SECRET (the shared X-Integration-Secret value)')
  process.exit(2)
}

// --- prod guard (Global Constraints) ---

const PROD_HOSTS = new Set(['ibuild4you.com', 'www.ibuild4you.com'])
let hostname
try {
  hostname = new URL(BASE).hostname
} catch {
  log(`E2E_BASE is not a valid URL: ${BASE}`)
  process.exit(1)
}
const IS_PROD_HOST = PROD_HOSTS.has(hostname)
if (IS_PROD_HOST && !ALLOW_PROD) {
  log(`Refusing to run against production host "${hostname}" without --allow-prod. Aborting before any request.`)
  process.exit(1)
}

// --- bypass token (optional) ---

let BYPASS_TOKEN = null
try {
  BYPASS_TOKEN = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
} catch {
  BYPASS_TOKEN = null // fine — most local/CI runs won't have this file
}

// --- constants (contract 08a) ---

const NAMESPACE = 'stars-demo'
const SECRET_HEADER = 'X-Integration-Secret'
const NAMESPACE_HEADER = 'X-Integration-Namespace'
const BYPASS_HEADER = 'x-vercel-protection-bypass'

const ROUND = 'r2'
const TOPICS = ['star-data', 'admissions', 'self-service']

const MESSAGES_PATH = '/api/integrations/stars-demo/messages'
const DELETE_PATH = '/api/integrations/stars-demo/messages/delete'
const ENSURE_PATH = '/api/integrations/stars-demo/participants/ensure'
const ERASE_PATH = '/api/integrations/stars-demo/participants/erase'
const NS_ERASE_PATH = '/api/integrations/stars-demo/namespace/erase'

const RUN_ID = `smoke-${Date.now().toString(36)}`
const P1 = `${RUN_ID}-p1`
const P2 = `${RUN_ID}-p2`
const P3 = `${RUN_ID}-p3`
const LABEL1 = 'Smoke P1'
const LABEL2 = 'Smoke P2'
const LABEL3 = 'Smoke P3'
const TOPIC_TITLE = 'Synthetic smoke topic'
const TOPIC_PROMPT = 'Synthetic smoke topic prompt used only by this script.'

const sendKey = (topic, pid) => `r2:${topic}:${pid}:${randomUUID()}`
const eraseKey = (pid) => `r2:erase:${pid}:${randomUUID()}`
const nsEraseKey = () => `r2:namespace-erase:${randomUUID()}`

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

// Durable order per 08a §2: created_at ascending, doc id breaks ties.
function sortedByCreatedThenId(messages) {
  return [...messages].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// --- tallying ---

let passedCount = 0
let failedCount = 0

function check(name, condition, detail) {
  if (condition) {
    passedCount++
    log(`ok  ${name}`)
  } else {
    failedCount++
    log(`FAIL ${name} — ${detail ?? ''}`)
  }
}

function detail(res) {
  const base = `status=${res.status} body=${JSON.stringify(res.json)}`
  return res.networkError ? `${base} networkError=${res.networkError}` : base
}

// Wraps a checklist step so one unexpected error (e.g. a network failure with
// no live target yet) fails that step's check instead of crashing the script.
async function step(name, fn) {
  try {
    return await fn()
  } catch (err) {
    check(`${name} (unexpected error)`, false, err && err.message ? err.message : String(err))
    return undefined
  }
}

// --- the call helper ---

const seenBodies = []

async function call(method, path, { body, headers = {}, secret = true } = {}) {
  const h = {
    'Content-Type': 'application/json',
    [NAMESPACE_HEADER]: NAMESPACE,
    ...(secret ? { [SECRET_HEADER]: SECRET } : {}),
    ...(BYPASS_TOKEN ? { [BYPASS_HEADER]: BYPASS_TOKEN } : {}),
    ...headers,
  }
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    seenBodies.push('')
    return { status: 0, json: null, request_id: undefined, networkError: err && err.message ? err.message : String(err) }
  }
  const text = await res.text()
  seenBodies.push(text)
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: res.status, json, request_id: json?.error?.request_id }
}

// --- 1. Fail closed ---

async function checkFailClosed() {
  const noSecret = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`, { secret: false })
  check(
    'no secret -> 401 unauthorized with uuid request_id',
    noSecret.status === 401 && noSecret.json?.error?.code === 'unauthorized' && UUID_RE.test(noSecret.json?.error?.request_id ?? ''),
    detail(noSecret)
  )

  const wrongNamespace = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`, {
    headers: { [NAMESPACE_HEADER]: 'other' },
  })
  check(
    'secret present but wrong namespace -> 401 unauthorized',
    wrongNamespace.status === 401 && wrongNamespace.json?.error?.code === 'unauthorized',
    detail(wrongNamespace)
  )
}

// --- 2. Ensure ---

async function checkEnsure() {
  const e1 = await call('POST', ENSURE_PATH, { body: { round: ROUND, participant_id: P1, author_label: LABEL1, topic_ids: TOPICS } })
  check('ensure p1 on all three topics -> 200 created', e1.status === 200 && e1.json?.created === true, detail(e1))

  const e2 = await call('POST', ENSURE_PATH, { body: { round: ROUND, participant_id: P2, author_label: LABEL2, topic_ids: ['star-data'] } })
  check('ensure p2 on star-data only -> 200 created', e2.status === 200 && e2.json?.created === true, detail(e2))

  const e3 = await call('POST', ENSURE_PATH, { body: { round: ROUND, participant_id: P3, author_label: LABEL3, topic_ids: ['admissions'] } })
  check('ensure p3 on admissions only -> 200 created', e3.status === 200 && e3.json?.created === true, detail(e3))

  const reEnsure = await call('POST', ENSURE_PATH, { body: { round: ROUND, participant_id: P1, author_label: LABEL1, topic_ids: TOPICS } })
  check(
    're-ensure p1 -> same success status, identical participant fields, created: false',
    reEnsure.status === e1.status &&
      reEnsure.json?.created === false &&
      reEnsure.json?.round === e1.json?.round &&
      reEnsure.json?.participant_id === e1.json?.participant_id &&
      JSON.stringify(reEnsure.json?.topic_ids) === JSON.stringify(e1.json?.topic_ids),
    detail(reEnsure)
  )
}

// --- 3. Two members, one topic ---

async function checkTwoMembersOneTopic() {
  const before = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  check('list star-data before sends -> 200', before.status === 200, detail(before))
  const versionBefore = before.json?.version

  const key1 = sendKey('star-data', P1)
  const send1 = await call('POST', MESSAGES_PATH, {
    body: {
      round: ROUND,
      topic_id: 'star-data',
      participant_id: P1,
      author_label: LABEL1,
      idempotency_key: key1,
      body: 'synthetic message one',
      topic_title: TOPIC_TITLE,
      topic_prompt: TOPIC_PROMPT,
    },
  })
  check(
    'p1 sends synthetic message one -> 200 with message + reply, version changed',
    send1.status === 200 && !!send1.json?.message && !!send1.json?.reply && send1.json?.version !== versionBefore,
    detail(send1)
  )

  const p2ListsAfterFirst = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  const afterFirst = p2ListsAfterFirst.json?.messages ?? []
  check(
    'p2 lists and sees p1 message then reply, in that order',
    afterFirst.length >= 2 && afterFirst[0]?.id === send1.json?.message?.id && afterFirst[1]?.id === send1.json?.reply?.id,
    detail(p2ListsAfterFirst)
  )
  const seenVersion = p2ListsAfterFirst.json?.version

  const key2 = sendKey('star-data', P2)
  const send2 = await call('POST', MESSAGES_PATH, {
    body: {
      round: ROUND,
      topic_id: 'star-data',
      participant_id: P2,
      author_label: LABEL2,
      idempotency_key: key2,
      body: 'synthetic message two',
      seen_version: seenVersion,
      topic_title: TOPIC_TITLE,
      topic_prompt: TOPIC_PROMPT,
    },
  })
  check(
    'p2 sends synthetic message two with seen_version -> 200 with message + reply',
    send2.status === 200 && !!send2.json?.message && !!send2.json?.reply,
    detail(send2)
  )

  const listA = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  const listB = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  const messagesA = listA.json?.messages ?? []
  check(
    'two consecutive lists identical, 4 messages, durable created_at/id order',
    listA.status === 200 &&
      listB.status === 200 &&
      messagesA.length === 4 &&
      JSON.stringify(listA.json) === JSON.stringify(listB.json) &&
      JSON.stringify(messagesA) === JSON.stringify(sortedByCreatedThenId(messagesA)),
    `${detail(listA)} | ${detail(listB)}`
  )

  return { send1, send2, key1 }
}

// --- 4. Non-member ---

async function checkNonMember() {
  const key3 = sendKey('star-data', P3)
  const send3 = await call('POST', MESSAGES_PATH, {
    body: {
      round: ROUND,
      topic_id: 'star-data',
      participant_id: P3,
      author_label: LABEL3,
      idempotency_key: key3,
      body: 'synthetic message from non-member',
      topic_title: TOPIC_TITLE,
      topic_prompt: TOPIC_PROMPT,
    },
  })
  check('p3 (not a star-data member) sends -> 403 forbidden', send3.status === 403 && send3.json?.error?.code === 'forbidden', detail(send3))

  // The list operation (GET .../messages) takes only round + topic_id — no
  // participant — so it cannot 403 a non-member. Nothing to check here; this
  // item only exercises p3's send.
}

// --- 5. Retry-safe key ---

async function checkRetrySafe(send1, key1) {
  const retry = await call('POST', MESSAGES_PATH, {
    body: {
      round: ROUND,
      topic_id: 'star-data',
      participant_id: P1,
      author_label: LABEL1,
      idempotency_key: key1,
      body: 'synthetic message one',
      topic_title: TOPIC_TITLE,
      topic_prompt: TOPIC_PROMPT,
    },
  })
  check(
    'resend p1 first request with same idempotency key -> 200, same message + reply ids',
    retry.status === 200 && retry.json?.message?.id === send1.json?.message?.id && retry.json?.reply?.id === send1.json?.reply?.id,
    detail(retry)
  )

  const list = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  check('list still has 4 messages after retry', (list.json?.messages ?? []).length === 4, detail(list))
}

// --- 6. Stale ---

async function checkStale() {
  const res = await call('POST', MESSAGES_PATH, {
    body: {
      round: ROUND,
      topic_id: 'star-data',
      participant_id: P1,
      author_label: LABEL1,
      idempotency_key: sendKey('star-data', P1),
      body: 'synthetic stale attempt',
      seen_version: 'not-the-current-version',
      topic_title: TOPIC_TITLE,
      topic_prompt: TOPIC_PROMPT,
    },
  })
  check('send with stale seen_version -> 409 stale', res.status === 409 && res.json?.error?.code === 'stale', detail(res))

  const list = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  check('list still has 4 messages after stale attempt', (list.json?.messages ?? []).length === 4, detail(list))
}

// --- 7. Delete cascade ---

async function checkDeleteCascade(send1, send2) {
  const before = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  const versionBefore = before.json?.version

  const del = await call('POST', DELETE_PATH, {
    body: {
      round: ROUND,
      topic_id: 'star-data',
      participant_id: P1,
      message_id: send1.json?.message?.id,
      idempotency_key: sendKey('star-data', P1),
    },
  })
  check(
    "delete p1's first message -> 200, removed ids include it",
    del.status === 200 && Array.isArray(del.json?.removed_message_ids) && del.json.removed_message_ids.includes(send1.json?.message?.id),
    detail(del)
  )

  const list = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=star-data`)
  const ids = (list.json?.messages ?? []).map((m) => m.id)
  check(
    "deleted message and its reply gone; p2's message + reply remain; version changed",
    !ids.includes(send1.json?.message?.id) &&
      !ids.includes(send1.json?.reply?.id) &&
      ids.includes(send2.json?.message?.id) &&
      ids.includes(send2.json?.reply?.id) &&
      list.json?.version !== versionBefore,
    detail(list)
  )
}

// --- 8. Erase person ---

async function checkErasePerson() {
  const erase1 = await call('POST', ERASE_PATH, { body: { round: ROUND, participant_id: P1, operation_key: eraseKey(P1) } })
  check('erase p1 -> 200 confirmed', erase1.status === 200 && erase1.json?.status === 'confirmed', detail(erase1))

  for (const topic of TOPICS) {
    const list = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=${topic}`)
    const messages = list.json?.messages ?? []
    const noAuthoredByP1 = !messages.some((m) => m.kind === 'participant' && m.author_id === P1)
    const noReplyDependedOnP1 = !messages.some((m) => m.kind === 'facilitator' && m.depends_on_participant_ids?.includes(P1))
    check(`${topic}: no message authored by p1 and no reply that depended on p1`, noAuthoredByP1 && noReplyDependedOnP1, detail(list))
  }

  const erase2 = await call('POST', ERASE_PATH, { body: { round: ROUND, participant_id: P1, operation_key: eraseKey(P1) } })
  check('erase p1 again with a new key -> still success', erase2.status === 200 && erase2.json?.status === 'confirmed', detail(erase2))

  const ensureAgain = await call('POST', ENSURE_PATH, { body: { round: ROUND, participant_id: P1, author_label: LABEL1, topic_ids: TOPICS } })
  check('ensure p1 again -> success, a fresh record', ensureAgain.status === 200 && ensureAgain.json?.created === true, detail(ensureAgain))
}

// --- 9. Leak check ---

function checkLeaks() {
  const all = seenBodies.join('\n')
  check('secret value never appears in any response body', !all.includes(SECRET), '(a response body contained the secret)')
  check("step-3 topic_prompt is never stored or echoed back", !all.includes(TOPIC_PROMPT), '(a response body contained the topic_prompt text)')
  check('no "@" character in any response body', !all.includes('@'), '(a response body contained an @ character)')
}

// --- 10. Cleanup ---

async function cleanup() {
  const eraseP2 = await call('POST', ERASE_PATH, { body: { round: ROUND, participant_id: P2, operation_key: eraseKey(P2) } })
  check('cleanup: erase p2 -> 200 confirmed', eraseP2.status === 200 && eraseP2.json?.status === 'confirmed', detail(eraseP2))

  const eraseP3 = await call('POST', ERASE_PATH, { body: { round: ROUND, participant_id: P3, operation_key: eraseKey(P3) } })
  check('cleanup: erase p3 -> 200 confirmed', eraseP3.status === 200 && eraseP3.json?.status === 'confirmed', detail(eraseP3))

  if (!NAMESPACE_ERASE_FLAG) return
  if (IS_PROD_HOST) {
    log('--namespace-erase was passed but the target host is production — refusing to run it, flag or not.')
    return
  }

  const nsErase = await call('POST', NS_ERASE_PATH, { body: { round: ROUND, operation_key: nsEraseKey() } })
  check('namespace erase -> 200 confirmed', nsErase.status === 200 && nsErase.json?.status === 'confirmed', detail(nsErase))

  for (const topic of TOPICS) {
    const list = await call('GET', `${MESSAGES_PATH}?round=${ROUND}&topic_id=${topic}`)
    check(
      `${topic}: list empty with version "none" after namespace erase`,
      list.status === 200 && (list.json?.messages ?? []).length === 0 && list.json?.version === 'none',
      detail(list)
    )
  }
}

// --- main ---

async function main() {
  log(`Target: ${BASE}${IS_PROD_HOST ? ' (production, --allow-prod)' : ''}`)
  log(`Run ID: ${RUN_ID}`)

  await step('1-fail-closed', checkFailClosed)
  await step('2-ensure', checkEnsure)
  const twoMembers = await step('3-two-members-one-topic', checkTwoMembersOneTopic)
  await step('4-non-member', checkNonMember)
  if (twoMembers) {
    await step('5-retry-safe-key', () => checkRetrySafe(twoMembers.send1, twoMembers.key1))
    await step('6-stale', checkStale)
    await step('7-delete-cascade', () => checkDeleteCascade(twoMembers.send1, twoMembers.send2))
  } else {
    check('5-retry-safe-key', false, 'skipped — step 3 did not complete')
    check('6-stale', false, 'skipped — step 3 did not complete')
    check('7-delete-cascade', false, 'skipped — step 3 did not complete')
  }
  await step('8-erase-person', checkErasePerson)
  checkLeaks()
  await step('10-cleanup', cleanup)

  log(`${passedCount + failedCount} checks, ${failedCount} failed`)
  process.exit(failedCount > 0 ? 1 : 0)
}

await main()
