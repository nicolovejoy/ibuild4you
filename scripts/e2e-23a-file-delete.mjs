#!/usr/bin/env node
// Verify #23a end-to-end on preview as the test admin: upload a file to a
// brief's Attachments, then delete it (S3 object + Firestore doc) via the UI.
// Exercises the full init -> presigned PUT -> confirm -> DELETE path.
//
// Usage: node scripts/e2e-23a-file-delete.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const EMAIL = process.env.E2E_EMAIL || 'test@ibuild4you.com'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`

// NB: keep "delete" out of the filename — getByRole name matching is substring,
// so a filename containing it would also match the file-card button.
const fname = `e2e-attach-${Date.now()}.txt`
const tmpPath = `/tmp/${fname}`
writeFileSync(tmpPath, 'phase-0 file delete verification\n')

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()

// Login
await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 10000 }).catch(() => {})
}
await page.waitForTimeout(1500)

// Go straight to the seeded brief's Brief tab (Attachments live there).
// Direct nav avoids the sectioned-dashboard h3 ambiguity.
await page.goto(`${BASE}/projects/test-waiting-reminder?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

// Upload via the hidden file input
const fileInput = page.locator('input[type="file"]')
await fileInput.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
check('Attachments file input present (on a brief page)', await fileInput.count() > 0)
const before = await page.getByText(fname).count()
await fileInput.first().setInputFiles(tmpPath)
// Wait for the file card to appear (confirm step done)
await page.getByText(fname).first().waitFor({ timeout: 20000 }).catch(() => {})
const appeared = await page.getByText(fname).count()
check('uploaded file appears in Attachments', appeared > before, `count ${before} -> ${appeared}`)
await page.screenshot({ path: `${shotDir}/e2e-23a-uploaded.png` })

// Open the file -> Delete -> confirm
await page.getByText(fname).first().click()
await page.waitForTimeout(1200)
const hasDelete = await page.getByRole('button', { name: 'Delete', exact: true }).count()
check('Delete button present in preview modal', hasDelete > 0)
if (hasDelete > 0) {
  // Normal clicks (auto-wait for stability) — force-clicks raced the modal
  // entrance animation. Wait for the confirm box, then click its filled Delete.
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await page.getByText(/This removes the file and any agent references/).waitFor({ timeout: 6000 })
  await page.getByRole('button', { name: 'Delete', exact: true }).nth(1).click()
  await page.getByText(fname).first().waitFor({ state: 'detached', timeout: 12000 }).catch(() => {})
}

// Back on the grid, the file should be gone
const after = await page.getByText(fname).count()
check('file removed from Attachments after delete', after === 0, `remaining ${after}`)
await page.screenshot({ path: `${shotDir}/e2e-23a-deleted.png` })

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shots in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
