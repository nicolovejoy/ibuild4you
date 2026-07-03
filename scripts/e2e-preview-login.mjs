#!/usr/bin/env node
// Drive a headless browser through preview.ibuild4you.com as the passcode-based
// test admin, for agent-driven UI verification on preview. Canonical example of
// the shared preview-login helper (see scripts/lib/preview-login.mjs).
//
// Usage:
//   node scripts/e2e-preview-login.mjs
// Visits /dashboard, screenshots it, then opens the first brief card.

import { launchLoggedIn, shotDir } from './lib/preview-login.mjs'

const { browser, page } = await launchLoggedIn({
  viewport: { width: 1400, height: 900 },
  verbose: true,
})

console.log('after-login url:', page.url())
await page.screenshot({ path: `${shotDir}/e2e-dashboard.png` })

// Open the first brief card and screenshot the builder console.
const card = page.locator('h3').first()
if (await card.count()) {
  await card.click()
  await page.waitForTimeout(2500)
  console.log('brief url:', page.url())
  await page.screenshot({ path: `${shotDir}/e2e-brief.png`, fullPage: false })
}

await browser.close()
console.log('done; shots in .playwright-mcp/')
