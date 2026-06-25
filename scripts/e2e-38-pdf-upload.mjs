#!/usr/bin/env node
// Verify #38 end-to-end on preview: a maker uploads 3 PDFs in ONE chat message
// and the agent reads + cites their content (not hallucinated), with no
// Anthropic 400 (the >4-cache_control-marker failure mode). A 2nd turn exercises
// the cache path (cache_read > 0 — checked separately via check-cache-read.mjs).
//
// Runs as the seeded multi-human cast's Originator (a maker) on test-cast-cafe.
// Seed first:  node scripts/with-preview-env.mjs node scripts/seed-test-cast.mjs --apply
//
// Usage: node scripts/e2e-38-pdf-upload.mjs
// Writes the chat session_id to /tmp/e2e-38-session.txt for the cache check.

import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const BRIEF_PATH = '/projects/test-cast-cafe'
const EMAIL = 'test-originator@ibuild4you.com'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcodes = JSON.parse(readFileSync(`${ROOT}.test-cast-passcodes.json`, 'utf8'))
const shotDir = `${ROOT}.playwright-mcp`

// --- minimal valid single-page PDF with one ASCII text line (no deps) ---
// Sentence must be ASCII and free of ( ) \ (PDF string delimiters).
function makePdf(sentence) {
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
  ]
  const stream = `BT /F1 18 Tf 72 720 Td (${sentence}) Tj ET`
  objs.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`)
  objs.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>')

  let pdf = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => { pdf += String(off).padStart(10, '0') + ' 00000 n \n' })
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

// Distinctive, unguessable content. filenames are generic so a quoted filename
// can't satisfy the content assertion.
const DOCS = [
  { file: 'doc-a.pdf', sentence: 'The mango ledger reconciles every Tuesday at noon.', cite: 'mango ledger' },
  { file: 'doc-b.pdf', sentence: 'Orchid Falcon manifest code is 7732 violet.', cite: 'orchid falcon' },
  { file: 'doc-c.pdf', sentence: 'Brass kettle inventory ships from dock nineteen.', cite: 'brass kettle' },
]
const paths = DOCS.map((d) => {
  const p = `/tmp/${d.file}`
  writeFileSync(p, makePdf(d.sentence))
  return p
})

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } })
const page = await ctx.newPage()

let sessionId = null
let chatError = false
page.on('response', async (resp) => {
  if (/\/api\/chat$/.test(resp.url()) && resp.request().method() === 'POST') {
    try {
      const body = JSON.parse(resp.request().postData() || '{}')
      if (body.session_id) sessionId = body.session_id
    } catch {}
    if (resp.status() >= 400) chatError = true
  }
})

// Login (passcode) and land on the maker chat.
await page.goto(`${BASE}${BRIEF_PATH}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcodes[EMAIL])
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForTimeout(3000)
}
// Always land squarely on the brief and let the maker view settle (kickoff /
// cold-start can delay the composer past a short wait).
await page.goto(`${BASE}${BRIEF_PATH}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
const box = page.getByPlaceholder('Type a message...')
await box.waitFor({ timeout: 30000 })
check('maker chat composer present', true)

// The composer textarea is `disabled` while the agent streams. Wait until it
// has been continuously enabled for `stableMs` (agent idle) or `maxMs` elapses.
async function waitIdle(maxMs = 45000, stableMs = 3500) {
  const start = Date.now()
  let enabledSince = null
  while (Date.now() - start < maxMs) {
    const disabled = await box.isDisabled().catch(() => true)
    if (disabled) enabledSince = null
    else if (enabledSince === null) enabledSince = Date.now()
    else if (Date.now() - enabledSince >= stableMs) return true
    await page.waitForTimeout(500)
  }
  return false
}

// Poll the full conversation text until every needle appears (lowercased), or
// timeout. Returns the set of needles still missing. Avoids brittle DOM-slice
// math — message bubbles insert mid-DOM, so length-slicing reads the wrong area.
async function waitForText(needles, timeoutMs = 45000) {
  const start = Date.now()
  let missing = needles.map((n) => n.toLowerCase())
  while (Date.now() - start < timeoutMs) {
    const txt = (await page.locator('main').innerText().catch(() => '')).toLowerCase()
    missing = missing.filter((n) => !txt.includes(n))
    if (!missing.length) return []
    await page.waitForTimeout(800)
  }
  return missing
}

// Let any returning-maker kickoff greeting fully stream + settle first, so it
// doesn't race with our upload turn.
await waitIdle()

// Upload all 3 PDFs in one go.
await page.locator('input[type="file"]').first().setInputFiles(paths)
// Wait for the 3 pending previews to appear and the upload to settle.
await page.waitForFunction(() => !document.body.innerText.includes('Uploading files...'), { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2000)
check('3 files uploaded (no upload error)', !chatError)

// Turn 1: ask for a per-file summary including any code/number.
await box.fill('Please summarize each document I attached — one short line per file, and include any code or number you see.')
await box.press('Enter')
await page.waitForTimeout(1500)
const missing1 = await waitForText(DOCS.map((d) => d.cite), 50000)
await waitIdle(8000)
await page.screenshot({ path: `${shotDir}/e2e-38-turn1.png`, fullPage: true })
for (const d of DOCS) {
  check(`agent cites "${d.cite}"`, !missing1.includes(d.cite))
}
check('no Anthropic 400 on turn 1', !chatError)

// Turn 2: force a re-read (exercises the cached prefix; cache proof is the
// api_usage check). 7732 may already be present from turn 1 — that's fine; this
// just confirms the multi-turn conversation keeps working without a 400.
await box.fill('Which document mentions the manifest code, and what is the code?')
await box.press('Enter')
await page.waitForTimeout(1500)
const missing2 = await waitForText(['7732'], 45000)
await waitIdle(8000)
await page.screenshot({ path: `${shotDir}/e2e-38-turn2.png`, fullPage: true })
check('manifest code 7732 surfaced', !missing2.includes('7732'))
check('no Anthropic 400 across both turns', !chatError)

if (sessionId) writeFileSync('/tmp/e2e-38-session.txt', sessionId)
console.log(`\nsession_id: ${sessionId || 'NOT CAPTURED'} (written to /tmp/e2e-38-session.txt)`)
console.log('Next: node scripts/with-preview-env.mjs node scripts/check-cache-read.mjs $(cat /tmp/e2e-38-session.txt)')

await browser.close()
const pass = results.every(Boolean)
console.log(pass ? '\n✅ ALL PASS — agent read + cited all 3 PDFs, no 400' : '\n❌ SOME FAILED')
process.exit(pass ? 0 : 1)
