#!/usr/bin/env node
// Verify #19 Phase 2 builder nav on preview: Brief · Conversations · People.
// Logs in as the passcode test admin, opens the seeded cast brief, and checks
// each tab renders its key content. Secrets read from gitignored files.

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ROOT = new URL('..', import.meta.url).pathname
const BASE = 'https://preview.ibuild4you.com'
const EMAIL = 'test@ibuild4you.com'
const SLUG = process.env.E2E_SLUG || 'test-cast-cafe'

const token = readFileSync(`${ROOT}.ibuild4you-bypass`, 'utf8').trim()
const passcode = readFileSync(`${ROOT}.test-admin-passcode`, 'utf8').trim()
const shotDir = `${ROOT}.playwright-mcp`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`${BASE}/dashboard?x-vercel-protection-bypass=${token}&x-vercel-set-bypass-cookie=true`, { waitUntil: 'domcontentloaded' })
await page.waitForURL(/\/(auth\/login|dashboard)/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(1500)
if (page.url().includes('/auth/login')) {
  await page.getByPlaceholder('you@example.com').fill(EMAIL)
  await page.getByPlaceholder('ABC123').fill(passcode)
  await page.getByRole('button', { name: 'Sign in with passcode' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 12000 }).catch(() => {})
}
await page.waitForTimeout(1500)
console.log('logged in:', page.url())

await page.goto(`${BASE}/projects/${SLUG}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
console.log('brief page:', page.url())

const navHas = async (name) => (await page.getByRole('button', { name, exact: true }).count()) > 0
const report = {}
report.navBrief = await navHas('Brief')
report.navConversations = await navHas('Conversations')
report.navPeople = await navHas('People')
report.noOldSessions = !(await navHas('Sessions'))
report.noOldSetup = !(await navHas('Setup'))

// Conversations tab (default): Next round + config + dispatch
await page.getByRole('button', { name: 'Conversations', exact: true }).first().click()
await page.waitForTimeout(1500)
report.nextRoundHeading = (await page.getByText('Next round', { exact: true }).count()) > 0
report.agentSetup = (await page.getByText('Agent setup').count()) > 0
await page.screenshot({ path: `${shotDir}/p2-conversations.png` })

// People tab: roster
await page.getByRole('button', { name: 'People', exact: true }).first().click()
await page.waitForTimeout(1500)
report.peoplePanel = (await page.getByText('People on this brief').count()) > 0
await page.screenshot({ path: `${shotDir}/p2-people.png` })

// Brief tab: brief + attachments fold-in
await page.getByRole('button', { name: 'Brief', exact: true }).first().click()
await page.waitForTimeout(1500)
report.attachments = (await page.getByText(/^Attachments/).count()) > 0
await page.screenshot({ path: `${shotDir}/p2-brief.png` })

console.log('RESULTS:', JSON.stringify(report, null, 2))
console.log('console errors:', errors.filter((e) => !/users\/me/.test(e)))
await browser.close()
const pass = Object.values(report).every(Boolean)
console.log(pass ? '\n✅ PASS' : '\n❌ FAIL')
process.exit(pass ? 0 : 1)
