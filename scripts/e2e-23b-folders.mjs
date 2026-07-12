#!/usr/bin/env node
// Verify #23b end-to-end on preview as the test admin: create a folder on a
// brief's Attachments, upload a file, move it into the folder via the preview
// modal, rename the folder, then remove the folder and confirm the file lands
// back in Unfiled (never deleted).
//
// Usage: node scripts/e2e-23b-folders.mjs

import { writeFileSync } from 'node:fs'
import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'

// Keep UI keywords ("delete", "folder", "rename") out of fixture names —
// getByRole/getByText matching is substring.
const stamp = Date.now()
const fname = `e2e-attach-${stamp}.txt`
const folderA = `Zone-${stamp}`
const folderB = `Area-${stamp}`
const tmpPath = `/tmp/${fname}`
writeFileSync(tmpPath, 'folders e2e verification\n')

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const { browser, page } = await launchLoggedIn()

await page.goto(`${BASE}/projects/test-waiting-reminder?tab=brief`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

// 1. Create a folder
const newFolderBtn = page.getByRole('button', { name: 'New folder' })
check('New folder button present', await newFolderBtn.count() > 0)
await newFolderBtn.first().click()
await page.getByPlaceholder('Folder name').fill(folderA)
await page.getByRole('button', { name: 'Create', exact: true }).click()
await page.getByText(folderA).first().waitFor({ timeout: 10000 }).catch(() => {})
check('folder appears with a section header', await page.getByText(folderA).count() > 0)
await page.screenshot({ path: `${shotDir}/e2e-23b-folder-created.png` })

// 2. Upload a file (lands in Unfiled)
const fileInput = page.locator('input[type="file"]')
await fileInput.first().setInputFiles(tmpPath)
await page.getByText(fname).first().waitFor({ timeout: 20000 }).catch(() => {})
check('uploaded file appears', await page.getByText(fname).count() > 0)

// 3. Move it into the folder via the preview modal select
await page.getByText(fname).first().click()
const folderSelect = page.locator('#move-file-folder')
await folderSelect.waitFor({ timeout: 6000 }).catch(() => {})
check('Folder select present in preview modal', await folderSelect.count() > 0)
await folderSelect.selectOption({ label: folderA })
await page.waitForTimeout(2000) // modal closes on successful move
// The file card should now render inside the folder's section: walk up from
// the folder-name span to its section wrapper and look for the filename there.
const inSection = await page.evaluate(({ folderName, fileName }) => {
  const spans = [...document.querySelectorAll('span')]
  const label = spans.find((s) => s.textContent === folderName)
  if (!label) return false
  const section = label.closest('div.space-y-2')
  return !!section && section.textContent.includes(fileName)
}, { folderName: folderA, fileName: fname })
check('file renders inside the folder section', inSection)
await page.screenshot({ path: `${shotDir}/e2e-23b-file-moved.png` })

// 4. Rename the folder
await page.getByRole('button', { name: `Rename folder ${folderA}` }).click()
const renameInput = page.locator(`input[value="${folderA}"]`)
await renameInput.waitFor({ timeout: 5000 }).catch(() => {})
await renameInput.fill(folderB)
await page.getByRole('button', { name: 'Save folder name' }).click()
await page.getByText(folderB).first().waitFor({ timeout: 10000 }).catch(() => {})
check('folder renamed', await page.getByText(folderB).count() > 0)

// 5. Remove the folder — file must land back in Unfiled, not vanish
await page.getByRole('button', { name: `Delete folder ${folderB}` }).click()
await page.getByText(/Files move back to Unfiled/).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Delete folder', exact: true }).click()
await page.getByText(folderB).first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
check('folder gone after removal', await page.getByText(folderB).count() === 0)
check('file survived folder removal (back in Unfiled)', await page.getByText(fname).count() > 0)
await page.screenshot({ path: `${shotDir}/e2e-23b-folder-removed.png` })

// Cleanup: delete the uploaded file
await page.getByText(fname).first().click()
await page.waitForTimeout(1200)
if (await page.getByRole('button', { name: 'Delete', exact: true }).count() > 0) {
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  await page.getByText(/This removes the file and any agent references/).waitFor({ timeout: 6000 })
  await page.getByRole('button', { name: 'Delete', exact: true }).nth(1).click()
  await page.getByText(fname).first().waitFor({ state: 'detached', timeout: 12000 }).catch(() => {})
}
check('cleanup: test file deleted', await page.getByText(fname).count() === 0)

await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed; shots in .playwright-mcp/`)
process.exit(passed === results.length ? 0 : 1)
