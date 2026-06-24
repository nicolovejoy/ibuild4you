#!/usr/bin/env node
// Full interactive test of the read-first brief editor on preview:
// read → edit → save (persists across reload) → revert → cancel-discards.
// Mutates the test-cast-cafe brief, then restores the original Problem text.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const SLUG = process.env.E2E_SLUG || 'test-cast-cafe'
const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`
const MARK = ' [E2E-EDIT-OK]'

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' && !/users\/me|401/.test(m.text())) errors.push(m.text()) })

const log = (s) => console.log(s)
const editBtn = () => page.getByRole('button', { name: /Edit brief/ }).first()
const saveBtn = () => page.getByRole('button', { name: 'Save brief' }).first()
const cancelBtn = () => page.getByRole('button', { name: /Cancel/ }).first()
const problemBox = () => page.locator('textarea').first()
const readHasMark = () => page.getByText(MARK.trim(), { exact: false }).count().then((n) => n > 0)

// login
await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill('test@ibuild4you.com')
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/dashboard/, { timeout: 12000 }).catch(() => {})
}

const open = async () => { await page.goto(`${BASE}/projects/${SLUG}?tab=brief`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000) }
await open()

const results = {}

// 0. capture original Problem text (enter edit, read, cancel)
await editBtn().click(); await page.waitForTimeout(700)
const original = await problemBox().inputValue()
results.readOriginal = original.length > 0
log(`original problem: ${JSON.stringify(original.slice(0, 50))}…`)
await cancelBtn().click(); await page.waitForTimeout(500)

// 1. EDIT + SAVE → persists
await editBtn().click(); await page.waitForTimeout(600)
await problemBox().fill(original + MARK)
await saveBtn().click(); await page.waitForTimeout(2500)
results.savedReturnsToRead = (await editBtn().count()) > 0 && (await saveBtn().count()) === 0
results.readShowsEdit = await readHasMark()
await page.screenshot({ path: `${shotDir}/bi-saved.png` })

// 2. reload → still persisted
await open()
results.persistsAfterReload = await readHasMark()

// 3. REVERT (restore original) + SAVE
await editBtn().click(); await page.waitForTimeout(600)
await problemBox().fill(original)
await saveBtn().click(); await page.waitForTimeout(2500)
results.revertedClean = !(await readHasMark())

// 4. CANCEL discards a real edit
await editBtn().click(); await page.waitForTimeout(600)
await problemBox().fill(original + ' [E2E-TEMP]')
await cancelBtn().click(); await page.waitForTimeout(600)
results.cancelReturnsRead = (await editBtn().count()) > 0 && (await saveBtn().count()) === 0
results.cancelDiscarded = (await page.getByText('E2E-TEMP', { exact: false }).count()) === 0

// 5. final state clean (reload, no markers)
await open()
results.finalClean = !(await readHasMark()) && (await page.getByText('E2E-TEMP').count()) === 0

log('RESULTS: ' + JSON.stringify(results, null, 2))
log('unexpected console errors: ' + JSON.stringify(errors))
await browser.close()
const pass = Object.values(results).every(Boolean) && errors.length === 0
log(pass ? '\n✅ PASS — edit/save/persist/revert/cancel all work; brief restored' : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
