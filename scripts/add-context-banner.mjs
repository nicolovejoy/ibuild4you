#!/usr/bin/env node
// Prepend a supersession/hygiene banner to a brief's builder-provided context.
// Goes through the deployed app's own authenticated PATCH (headless test-admin
// login) so the change is validated by the API route, not a raw Firestore
// write. Read-then-prepend: PATCH replaces `context` wholesale, so the current
// value is fetched first and the banner added on top. Idempotent — skips if
// the context already starts with the banner's first line.
//
// Prod:
//   E2E_BASE=https://ibuild4you.com E2E_PASSCODE_FILE=.test-admin-passcode-prod \
//     node scripts/add-context-banner.mjs <slug> "<banner text>"
//
// Verify afterwards read-only:
//   node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs

import { launchLoggedIn } from './lib/preview-login.mjs'

const [slug, banner] = process.argv.slice(2)
if (!slug || !banner) {
  console.error('Usage: node scripts/add-context-banner.mjs <slug> "<banner text>"')
  process.exit(1)
}

const { browser, page, BASE } = await launchLoggedIn()
try {
  // Capture the app's own Bearer token off request headers — more reliable
  // than driving admin UI click heuristics (see CLAUDE.md gotcha, 2026-07-04).
  let bearer = null
  page.on('request', (r) => {
    const a = r.headers()['authorization']
    if (a?.startsWith('Bearer ')) bearer = a
  })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' })
  for (let i = 0; i < 20 && !bearer; i++) await page.waitForTimeout(500)
  if (!bearer) throw new Error('never saw a Bearer token — login failed?')

  const res = await page.request.fetch(`${BASE}/api/projects?slug=${encodeURIComponent(slug)}`, {
    headers: { authorization: bearer },
  })
  if (!res.ok()) throw new Error(`GET project → ${res.status()}`)
  const project = await res.json()

  const existing = typeof project.context === 'string' ? project.context : ''
  const bannerFirstLine = banner.split('\n')[0].trim()
  if (existing.trimStart().startsWith(bannerFirstLine)) {
    console.log(`SKIP: "${slug}" context already carries this banner.`)
    process.exit(0)
  }

  const next = existing ? `${banner}\n\n${existing}` : banner
  const patch = await page.request.fetch(`${BASE}/api/projects`, {
    method: 'PATCH',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    data: JSON.stringify({ project_id: project.id, context: next }),
  })
  console.log(`PATCH ${slug} context (+${banner.length} char banner) → ${patch.status()}`)
  if (!patch.ok()) {
    console.error(await patch.text())
    process.exit(1)
  }
} finally {
  await browser.close()
}
