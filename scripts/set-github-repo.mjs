#!/usr/bin/env node
// Set projects.github_repo on a brief — the brief→repository mapping used by
// the feedback→GitHub-issue route and by export-brief.mjs --repo. Goes through
// the deployed app's own authenticated PATCH (headless test-admin login), so
// the change is validated by the API route, not a raw Firestore write.
//
// Prod:
//   E2E_BASE=https://ibuild4you.com E2E_PASSCODE_FILE=.test-admin-passcode-prod \
//     node scripts/set-github-repo.mjs <slug> <owner/name>
//
// Preview (default env): node scripts/set-github-repo.mjs <slug> <owner/name>
//
// Audit afterwards: node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs

import { launchLoggedIn } from './lib/preview-login.mjs'

const [slug, repo] = process.argv.slice(2)
if (!slug || !repo) {
  console.error('Usage: node scripts/set-github-repo.mjs <slug> <owner/name>')
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

  const list = await page.request.fetch(`${BASE}/api/projects`, {
    headers: { authorization: bearer },
  })
  const projects = await list.json() // GET /api/projects returns a bare array
  const project = (Array.isArray(projects) ? projects : []).find((p) => p.slug === slug)
  if (!project) throw new Error(`no project with slug "${slug}" visible to the test admin`)

  const res = await page.request.fetch(`${BASE}/api/projects`, {
    method: 'PATCH',
    headers: { authorization: bearer, 'content-type': 'application/json' },
    data: JSON.stringify({ project_id: project.id, github_repo: repo }),
  })
  console.log(`PATCH ${slug} github_repo=${repo} → ${res.status()}`)
  if (!res.ok()) {
    console.error(await res.text())
    process.exit(1)
  }
} finally {
  await browser.close()
}
