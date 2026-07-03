#!/usr/bin/env node
// #106 verification on preview: drive the People panel on the seeded multi-human
// cast (slug test-cast-cafe) as the test admin — change an access tier, move a
// member out (removed section + restore), and screenshot each state.
//
// Prereqs: cast seeded (node scripts/with-preview-env.mjs node scripts/seed.mjs
// multi-human-cast --apply) and the branch on preview.
//
// Usage: node scripts/e2e-106-people-panel.mjs

import { launchLoggedIn, BASE, shotDir } from './lib/preview-login.mjs'

const SLUG = 'test-cast-cafe'
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const { browser, page } = await launchLoggedIn()

// People tab of the cast brief.
await page.goto(`${BASE}/projects/${SLUG}?tab=people`, { waitUntil: 'domcontentloaded' })
await page.getByText('People on this brief').first().waitFor({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(1500)

check('People panel renders', (await page.getByText('People on this brief').count()) > 0)
const tierSelects = await page.getByLabel('Access tier').count()
check('access-tier selects present (one per member)', tierSelects >= 4, `${tierSelects} selects`)
const removeBtns = await page.getByLabel('Remove from brief').count()
check('remove controls present', removeBtns > 0, `${removeBtns} buttons`)
await page.screenshot({ path: `${shotDir}/e2e-106-people-initial.png`, fullPage: true })

// Move out the Contributor (Tomas) — find his row by email, click its Remove.
const tomasRow = page.locator('li', { hasText: 'test-contributor@ibuild4you.com' }).first()
const removed = (await tomasRow.count()) > 0
check('contributor row found', removed)
if (removed) {
  await tomasRow.getByLabel('Remove from brief').click()
  await page.getByText(/Remove .* from this brief\?/).first().waitFor({ timeout: 6000 })
  await page.screenshot({ path: `${shotDir}/e2e-106-remove-confirm.png`, fullPage: true })
  // Click the red confirm "Remove".
  await page.getByRole('button', { name: 'Remove', exact: true }).first().click()
  // The Removed section should now list the contributor with a Restore action.
  await page.getByText('Removed', { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const inRemoved =
    (await page.locator('li', { hasText: 'test-contributor@ibuild4you.com' }).filter({ hasText: 'Restore' }).count()) > 0
  check('contributor moved to Removed section with Restore', inRemoved)
  await page.screenshot({ path: `${shotDir}/e2e-106-removed.png`, fullPage: true })

  // Restore — put the cast back the way it was for the next viewer.
  await page.getByRole('button', { name: /Restore/ }).first().click()
  await page.waitForTimeout(1500)
  const restored = (await page.getByLabel('Access tier').count()) >= 4
  check('contributor restored (back to active roster)', restored)
  await page.screenshot({ path: `${shotDir}/e2e-106-restored.png`, fullPage: true })
}

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shots in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
