#!/usr/bin/env node
// Smoke check for POST /api/build-status, the endpoint a build repo's Claude
// Code posts its status report to with the repo's own status key.
//
// Usage:
//   node scripts/smoke-build-status.mjs --base https://preview.ibuild4you.com --repo owner/name --project <slug> --key-file <path> [--allow-prod]
//
// The key is read from --key-file, never from an argument, so it does not land
// in shell history or a process list. Production (ibuild4you.com or
// www.ibuild4you.com) is refused without --allow-prod, since the good report is
// a real write. The Vercel protection bypass token is read from
// .ibuild4you-bypass and sent as the x-vercel-protection-bypass header only to
// a host ending in .ibuild4you.com (not production) or .vercel.app (the same
// file preview-login.mjs uses); any other host gets no bypass header.
//
// One PASS or FAIL line per check, exit 1 on any FAIL:
//   1. no key                     -> 401
//   2. wrong key                  -> 401
//   3. a live item with no checked -> 400
//   4. a good report              -> 201
//   5. the same report again      -> 200 with duplicate: true
//
// The good report is a real write: it lands on the project and is shown in its
// next prep until a stamped paste folds it. Its text says it is a smoke test.
// Lines print statuses and a 4xx body's `error` only: never the key, the
// bypass token, or any other part of a response.

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('..', import.meta.url).pathname
const PROD_HOSTS = new Set(['ibuild4you.com', 'www.ibuild4you.com'])

export const isProdBase = (base) => PROD_HOSTS.has(new URL(base).hostname)

// The bypass token for a host behind Vercel's protection (a preview subdomain
// of ibuild4you.com, or a *.vercel.app deployment), else null without reading
// it. `readToken` is for tests, so they never touch the real token file.
export function bypassFor(base, readToken = () => readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8')) {
  const host = new URL(base).hostname
  if (PROD_HOSTS.has(host)) return null
  if (!host.endsWith('.ibuild4you.com') && !host.endsWith('.vercel.app')) return null
  return readToken().trim()
}

// A good report. `tag` makes the text unique, so a rerun inside the ten-minute
// duplicate window still gets 201 on its first post.
export function goodReport({ repo, project, tag }) {
  return {
    repo,
    project,
    brief_version_checked: 0,
    live: [
      {
        what: `Smoke test report ${tag}, not real: ignore`,
        checked: 'Posted by scripts/smoke-build-status.mjs; nothing was deployed',
      },
    ],
    merged: [],
    proposed: [],
    questions: [`Smoke test question ${tag}, not real: ignore`],
  }
}

// POST one body. Resolves to { status, error, duplicate }; a network failure
// becomes status 0 with its first message line (no headers in it).
export async function postReport({ base, bypass, key, body }) {
  const headers = { 'content-type': 'application/json' }
  if (bypass) headers['x-vercel-protection-bypass'] = bypass
  if (key) headers.authorization = `Bearer ${key}`
  let res
  try {
    res = await fetch(`${base}/api/build-status`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e) {
    return { status: 0, error: String(e?.message ?? e).split('\n')[0] }
  }
  const json = await res.json().catch(() => ({}))
  return { status: res.status, error: typeof json.error === 'string' ? json.error : undefined, duplicate: json.duplicate === true }
}

// One printable line. `error` is only shown when it is not the expected result.
function line(ok, label, result) {
  const detail = result.error && !ok ? ` (${result.error})` : ''
  return `${ok ? 'PASS' : 'FAIL'}: ${label} -> ${result.status}${detail}`
}

// Runs the five checks. Returns the number of failures.
export async function runSmoke({ base, repo, project, key, bypass, log = console.log }) {
  let failures = 0
  const check = (ok, label, result) => {
    log(line(ok, label, result))
    if (!ok) failures++
  }

  const tag = randomBytes(4).toString('hex')
  const good = goodReport({ repo, project, tag })

  const noKey = await postReport({ base, bypass, key: null, body: good })
  check(noKey.status === 401, 'no key', noKey)

  // Right shape, wrong value: random, so it can never be a live key.
  const wrong = await postReport({ base, bypass, key: `bsk_${randomBytes(24).toString('hex')}`, body: good })
  check(wrong.status === 401, 'wrong key', wrong)

  const unchecked = await postReport({
    base,
    bypass,
    key,
    body: { ...good, live: [{ what: `Smoke test item ${tag} with no checked` }] },
  })
  check(unchecked.status === 400, 'live item without checked', unchecked)

  const first = await postReport({ base, bypass, key, body: good })
  check(first.status === 201, 'good report', first)

  const again = await postReport({ base, bypass, key, body: good })
  check(again.status === 200 && again.duplicate, `same report again (duplicate: ${again.duplicate === true})`, again)

  return failures
}

// Flags that take no value.
const BOOLEAN_FLAGS = new Set(['--allow-prod'])

export function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    if (BOOLEAN_FLAGS.has(name)) {
      args[name.slice(2)] = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
    args[name.slice(2)] = value
    i++
  }
  return args
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  const { base, repo, project } = args
  const keyFile = args['key-file']
  if (!base || !repo || !project || !keyFile) {
    console.error('Usage: node scripts/smoke-build-status.mjs --base <url> --repo owner/name --project <slug> --key-file <path> [--allow-prod]')
    process.exit(2)
  }
  const cleanBase = base.replace(/\/+$/, '')
  try {
    new URL(cleanBase)
  } catch {
    console.error('--base must be a full URL, such as https://preview.ibuild4you.com')
    process.exit(2)
  }
  if (isProdBase(cleanBase) && args['allow-prod'] !== true) {
    console.error('Refusing to run against production without --allow-prod: the good report is a real write.')
    process.exit(2)
  }

  const key = readFileSync(keyFile, 'utf8').trim()
  if (!key) {
    console.error('The key file is empty.')
    process.exit(2)
  }
  const bypass = bypassFor(cleanBase)

  console.log(`smoke: ${cleanBase} repo ${repo} project ${project} (bypass header: ${bypass ? 'yes' : 'no'})`)
  const failures = await runSmoke({ base: cleanBase, repo, project, key, bypass })
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
