#!/usr/bin/env node
// Verify #23 Phase 1 (#16 leftover) end-to-end on preview: deleting a brief
// also removes its uploaded files' S3 objects (no orphans).
//
// Flow: login -> create throwaway brief -> upload a file (real S3 PUT) ->
// capture its storage_path from GET /api/files -> assert the S3 object EXISTS
// -> delete the brief via the Danger zone control -> assert the S3 object is
// GONE (HeadObject 404). Preview Firestore is sandboxed; S3 is the shared
// ibuild4you-files bucket, so this exercises the real delete path.
//
// Usage: node scripts/e2e-23-p1-brief-delete-s3.mjs
// Needs: .ibuild4you-bypass, .test-admin-password, AWS creds (default chain).

import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3'
import { loginPage, BASE, shotDir } from './lib/preview-login.mjs'

const BUCKET = process.env.AWS_S3_BUCKET || 'ibuild4you-files'
const REGION = process.env.AWS_REGION || 'us-east-1'
const TITLE = `ZZ s3-cleanup ${Date.now().toString(36)}`

const fname = `e2e-s3cleanup-${Date.now()}.txt`
const tmpPath = `/tmp/${fname}`
writeFileSync(tmpPath, 'phase-1 s3 orphan cleanup verification\n')

const s3 = new S3Client({ region: REGION })
const exists = async (key) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false
    throw err
  }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()

// Capture storage_path from any GET /api/files response.
let storagePath = null
page.on('response', async (resp) => {
  const u = resp.url()
  if (/\/api\/files\?/.test(u) && resp.request().method() === 'GET') {
    try {
      const body = await resp.json()
      const match = Array.isArray(body) && body.find((f) => f.filename === fname && f.storage_path)
      if (match) storagePath = match.storage_path
    } catch {}
  }
})

// Login
await loginPage(page)

// 1. Create a throwaway brief.
await page.getByRole('button', { name: 'New brief' }).click()
await page.waitForTimeout(600)
await page.locator('#project-title').fill(TITLE)
await page.getByRole('button', { name: 'Create brief' }).click()
await page.waitForURL(/\/projects\//, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(2500)
const projUrl = page.url()
console.log('created brief:', TITLE, '->', projUrl)

// 2. Upload a file on the Brief tab (Attachments).
const briefUrl = projUrl.split('?')[0] + '?tab=brief'
await page.goto(briefUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
const fileInput = page.locator('input[type="file"]').first()
await fileInput.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {})
check('Attachments file input present', await page.locator('input[type="file"]').count() > 0)
await fileInput.setInputFiles(tmpPath)
await page.getByText(fname).first().waitFor({ timeout: 25000 }).catch(() => {})
check('file card appeared after upload', await page.getByText(fname).count() > 0)

// Give the GET /api/files refetch a beat to land + populate storagePath.
await page.waitForTimeout(2500)
check('captured storage_path from API', !!storagePath, storagePath || 'none')

// 3. Assert the S3 object exists pre-delete.
const existedBefore = storagePath ? await exists(storagePath) : false
check('S3 object exists before brief delete', existedBefore)

// 4. Delete the brief via the Danger zone control.
await page.goto(projUrl, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
const convTab = page.getByRole('button', { name: /Conversations/i }).first()
if (await convTab.count()) { await convTab.click(); await page.waitForTimeout(1200) }
await page.getByRole('button', { name: /Agent setup/i }).first().click()
await page.waitForTimeout(600)
await page.getByText('Advanced', { exact: true }).first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Delete brief' }).click()
await page.waitForTimeout(600)
await page.locator('#brief-delete-confirm').fill('delete')
const delResp = page.waitForResponse((r) => /\/api\/projects/.test(r.url()) && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null)
await page.getByRole('button', { name: 'Delete', exact: true }).click()
const dr = await delResp
check('brief DELETE returned 200', dr && dr.status() === 200, dr ? String(dr.status()) : 'none')
await page.waitForURL(/\/dashboard/, { timeout: 12000 }).catch(() => {})
await page.waitForTimeout(2000)

// 5. Assert the S3 object is gone (give S3 a moment for consistency).
await page.waitForTimeout(2000)
const existsAfter = storagePath ? await exists(storagePath) : true
check('S3 object removed after brief delete', !existsAfter, storagePath || 'no key captured')

await page.screenshot({ path: `${shotDir}/e2e-23-p1-after.png` })
await browser.close()

const pass = results.every(Boolean)
console.log(pass ? '\n✅ ALL PASS — brief delete cleans up the S3 object' : '\n❌ SOME FAILED')
process.exit(pass ? 0 : 1)
