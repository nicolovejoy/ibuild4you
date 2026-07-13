#!/usr/bin/env node
// Verify #83 Phase A end-to-end on preview as the test admin, on a brief's
// Attachments (folded into the Brief tab): add a linked artifact with a
// description, confirm it renders as a link; pin it and confirm it jumps to the
// Pinned section; unpin it; then delete it (links flow through the same delete
// path, skipping S3).
//
// If the page is stuck on "Loading…", reseed the brief first:
//   node scripts/with-preview-env.mjs node scripts/seed-waiting-brief.mjs --apply
//
// Usage: node scripts/e2e-83-artifacts.mjs

import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'

const stamp = Date.now()
const linkName = `Mock-${stamp}` // avoid UI keywords (delete/pin/link) in fixture names
const linkUrl = `https://example.com/mock/${stamp}`
const linkDesc = `sample screen ${stamp}`

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const { browser, page } = await launchLoggedIn()

await page.goto(`${BASE}/projects/test-waiting-reminder?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

// 1. Open the Add link form and create a linked artifact
const addLinkBtn = page.getByRole('button', { name: 'Add link' })
check('Add link button present', (await addLinkBtn.count()) > 0)
await addLinkBtn.first().click()
await page.getByPlaceholder(/https/).fill(linkUrl)
await page.getByPlaceholder(/Display name/).fill(linkName)
await page.getByPlaceholder(/One line/).fill(linkDesc)
// The form's own submit button (second "Add link" — the first is the toolbar toggle)
await page.getByRole('button', { name: 'Add link' }).last().click()
await page.getByText(linkName).first().waitFor({ timeout: 12000 }).catch(() => {})
check('linked artifact card appears', (await page.getByText(linkName).count()) > 0)
check('description shows on the card', (await page.getByText(linkDesc).count()) > 0)
await page.screenshot({ path: `${shotDir}/e2e-83-link-added.png` })

// 2. Pin it via the modal (open card → Pin)
await page.getByText(linkName).first().click()
await page.waitForTimeout(1200)
const openLink = page.getByRole('link', { name: 'Open' })
check('modal shows Open (link, not download)', (await openLink.count()) > 0)
const pinBtn = page.getByRole('button', { name: 'Pin', exact: true })
check('Pin button present in modal', (await pinBtn.count()) > 0)
await pinBtn.first().click()
await page.waitForTimeout(1500)
// Close modal (Escape) and check the Pinned section contains the card
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
const inPinned = await page.evaluate((name) => {
  const labels = [...document.querySelectorAll('p')]
  const pinnedHeader = labels.find((p) => p.textContent.trim() === 'Pinned')
  if (!pinnedHeader) return false
  const section = pinnedHeader.closest('div.space-y-2')
  return !!section && section.textContent.includes(name)
}, linkName)
check('artifact appears under the Pinned section', inPinned)
await page.screenshot({ path: `${shotDir}/e2e-83-pinned.png` })

// 3. Unpin it — Pinned section should no longer contain it
await page.getByText(linkName).first().click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Pinned', exact: true }).first().click()
await page.waitForTimeout(1500)
await page.keyboard.press('Escape')
await page.waitForTimeout(800)
const stillPinned = await page.evaluate((name) => {
  const labels = [...document.querySelectorAll('p')]
  const pinnedHeader = labels.find((p) => p.textContent.trim() === 'Pinned')
  if (!pinnedHeader) return false
  const section = pinnedHeader.closest('div.space-y-2')
  return !!section && section.textContent.includes(name)
}, linkName)
check('artifact left the Pinned section after unpin', !stillPinned)

// 4. Delete the linked artifact (cleanup; links skip S3)
await page.getByText(linkName).first().click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
await page.getByText(/This removes the link and any agent references/).waitFor({ timeout: 6000 })
await page.getByRole('button', { name: 'Delete', exact: true }).nth(1).click()
await page.getByText(linkName).first().waitFor({ state: 'detached', timeout: 12000 }).catch(() => {})
check('cleanup: linked artifact deleted', (await page.getByText(linkName).count()) === 0)
await page.screenshot({ path: `${shotDir}/e2e-83-deleted.png` })

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shots in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
