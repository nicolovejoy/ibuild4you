#!/usr/bin/env node
// Full exercise of #16: create a throwaway brief, then DELETE it through the
// relocated control (brief → Conversations → Agent setup → Advanced → Danger
// zone → type "delete"), and confirm it's gone + we land back on /dashboard.
// Safe: preview Firestore is sandboxed and the brief is freshly created here.

import { chromium } from 'playwright'
import { loginPage, BASE, shotDir } from './lib/preview-login.mjs'

const TITLE = `ZZ delete-cycle ${Date.now().toString(36)}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()

// Login
await loginPage(page)

// 1. Create a throwaway brief via the form.
await page.getByRole('button', { name: 'New brief' }).click()
await page.waitForTimeout(600)
await page.locator('#project-title').fill(TITLE)
const createResp = page.waitForResponse((r) => /\/api\/projects$/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null)
await page.getByRole('button', { name: 'Create brief' }).click()
await createResp
// Create navigates straight to the new brief on the Conversations tab.
await page.waitForURL(/\/projects\//, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(2500)
console.log('created brief:', TITLE, '-> url:', page.url())

// 3. Navigate to the relocated delete control (already on Conversations tab).
const convTab = page.getByRole('button', { name: /Conversations/i }).first()
if (await convTab.count()) { await convTab.click(); await page.waitForTimeout(1200) }
await page.getByRole('button', { name: /Agent setup/i }).first().click()
await page.waitForTimeout(600)
await page.getByText('Advanced', { exact: true }).first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Delete brief' }).click()
await page.waitForTimeout(600)

// 4. Confirm + delete.
await page.locator('#brief-delete-confirm').fill('delete')
const delResp = page.waitForResponse((r) => /\/api\/projects/.test(r.url()) && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
await page.getByRole('button', { name: 'Delete', exact: true }).click()
const dr = await delResp
console.log('DELETE status:', dr ? dr.status() : 'none')

// 5. Land on dashboard; the brief should be gone.
await page.waitForURL(/\/dashboard/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(2500)
await page.locator('h3').first().waitFor({ timeout: 12000 }).catch(() => {})
const stillThere = await page.getByRole('heading', { name: TITLE }).count()
await page.screenshot({ path: `${shotDir}/e2e-16-after-delete.png` })
console.log('redirected to dashboard:', /\/dashboard/.test(page.url()))
console.log('brief still on dashboard:', stillThere > 0)

await browser.close()
const pass = dr && dr.status() === 200 && /\/dashboard/.test(page.url()) && stillThere === 0
console.log(pass
  ? '\n✅ PASS — created, deleted via relocated control, gone from dashboard'
  : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
