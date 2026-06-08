#!/usr/bin/env node
// Verify 3c on preview: (1) the chrome role badge reflects stored brief_role —
// the Contributor should read CONTRIBUTOR, not ORIGINATOR; (2) the builder
// Setup-tab People panel lists the cast with their roles.
//
// Secret hygiene: bypass token + passcodes from gitignored files, never printed.
// Usage: node scripts/e2e-cast-verify.mjs

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const BRIEF_PATH = '/projects/test-cast-cafe'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcodes = JSON.parse(readFileSync(`${ROOT}.test-cast-passcodes.json`, 'utf8'))
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()

async function login(ctx, page, email) {
  await page.goto(
    `${BASE}${BRIEF_PATH}?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.waitForTimeout(1500)
  if (page.url().includes('/auth/login')) {
    await page.getByPlaceholder('you@example.com').fill(email)
    await page.getByPlaceholder('ABC123').fill(passcodes[email])
    await page.getByRole('button', { name: 'Sign in with passcode' }).click()
    await page.waitForTimeout(2500)
    if (!page.url().includes('/projects/')) {
      await page.goto(`${BASE}${BRIEF_PATH}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    }
  }
}

// (1) Contributor badge
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  const page = await ctx.newPage()
  await login(ctx, page, 'test-contributor@ibuild4you.com')
  await page.waitForTimeout(1500)
  const header = await page.locator('header, [class*="header"]').first().innerText().catch(() => '')
  const badge = (await page.locator('text=/ORIGINATOR|CONTRIBUTOR|REVIEWER/i').first().innerText().catch(() => '')) || '(none found)'
  await page.screenshot({ path: `${shotDir}/verify-contributor-badge.png` })
  console.log('CONTRIBUTOR login — badge text:', badge.trim())
  console.log('  (expect CONTRIBUTOR; bug was ORIGINATOR)')
  await ctx.close()
}

// (2) Owner → Setup tab People panel
{
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } })
  const page = await ctx.newPage()
  await login(ctx, page, 'test-owner@ibuild4you.com')
  await page.waitForTimeout(1500)
  // Builder console: click the Setup nav.
  await page.getByRole('button', { name: /Setup/i }).first().click().catch(() => {})
  await page.waitForTimeout(2500)
  const panel = await page.locator('text=People on this brief').first().isVisible().catch(() => false)
  console.log('\nOWNER login — "People on this brief" panel visible:', panel)
  const roster = await page.locator('main').innerText().catch(() => '')
  // Print just the lines around the roster.
  const idx = roster.indexOf('People on this brief')
  console.log(idx >= 0 ? roster.slice(idx, idx + 400) : '(panel text not found)')
  await page.screenshot({ path: `${shotDir}/verify-people-panel.png`, fullPage: true })
  await ctx.close()
}

await browser.close()
console.log('\ndone; shots in .playwright-mcp/')
