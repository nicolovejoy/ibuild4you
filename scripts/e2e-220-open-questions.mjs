// Smoke for #220 on preview: open questions for the maker (card, copy, dashboard count).
// Usage: node scripts/e2e-220-open-questions.mjs
// Needs .ibuild4you-bypass + .test-admin-password (see scripts/lib/preview-login.mjs).
// Creates a throwaway brief ("— delete me") through the API as the logged-in admin.
import { launchLoggedIn, shotDir, BASE } from './lib/preview-login.mjs'

const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const stamp = Math.floor(performance.now()).toString(36)
const TITLE = `E2E220 open questions ${stamp} — delete me`

const { browser, page } = await launchLoggedIn({ viewport: { width: 1400, height: 1000 } })

// Clipboard stub before any page script runs.
await page.addInitScript(() => {
  window.__clip = []
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__clip.push(t) } }, configurable: true })
})

// Capture the Bearer token from the app's own API calls (see e2e-214). Errors are cut
// to their first line: Playwright's full error echoes headers.
let auth = null
page.on('request', (r) => { const a = r.headers()['authorization']; if (a && /\/api\//.test(r.url())) auth = a })
const call = (method, path, data) =>
  page.request
    .fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
    })
    .catch((e) => { throw new Error(`${method} ${path}: ${String(e.message).split('\n')[0]}`) })

const openBriefTab = async (slug) => {
  await page.goto(`${BASE}/projects/${slug}`, { waitUntil: 'domcontentloaded' })
  const tab = page.getByText(/^Brief$/).first()
  await tab.waitFor({ timeout: 15000 })
  await tab.click()
  await page.waitForTimeout(1500)
}
const dashboardCard = () => page.locator('div.cursor-pointer:has(h3)', { hasText: TITLE }).first()

try {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.locator('div.cursor-pointer:has(h3)').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  if (!auth) throw new Error('no Bearer token captured')

  // 1. Create the brief with one owned-by-maker risk among others.
  const resp = await call('POST', '/api/projects', {
    title: TITLE,
    requester_first_name: 'Mara',
    brief: { problem: 'smoke', open_risks: ['plain risk', { text: 'Which stations?', owner: 'maker' }, { text: 'Hosting', owner: 'builder' }] },
  })
  if (resp.status() !== 201) throw new Error(`create failed: ${resp.status()}`)
  const proj = await resp.json()
  const projectId = proj.id || proj.project_id
  const slug = proj.slug
  console.log('created', projectId, slug)

  // 2. Card shows only the maker-owned question.
  await openBriefTab(slug)
  const card = page.locator('[data-testid=open-questions]')
  ok('open-questions card visible', await card.isVisible())
  ok('exactly one item', (await card.locator('li').count()) === 1)
  ok('item is "Which stations?"', ((await card.locator('li').first().textContent()) || '').trim() === 'Which stations?')
  ok('heading names Mara (1)', ((await card.locator('h3').first().textContent()) || '').includes('Open questions for Mara (1)'))
  await page.screenshot({ path: `${shotDir}/smoke-220-card.png` })

  // 3. Copy as markdown.
  await page.locator('[data-testid=open-questions-copy]').click()
  await page.waitForTimeout(500)
  const clip = await page.evaluate(() => window.__clip)
  const text = clip?.[clip.length - 1] || ''
  const expected = `## Open questions for Mara — ${TITLE}\n\n- Which stations?\n`
  ok('copied markdown matches', text === expected, JSON.stringify(text))

  // 4. Dashboard row count.
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await dashboardCard().waitFor({ timeout: 15000 })
  ok('dashboard card shows "1 for Mara"', ((await dashboardCard().textContent()) || '').includes('1 for Mara'))
  await page.screenshot({ path: `${shotDir}/smoke-220-dashboard-1.png` })

  // 5. Hosting becomes maker-owned via a pasted brief.
  const put = await call('PUT', '/api/briefs', {
    project_id: projectId,
    source: 'paste',
    content: { problem: 'smoke', open_risks: ['plain risk', { text: 'Which stations?', owner: 'maker' }, { text: 'Hosting', owner: 'maker' }] },
  })
  ok('PUT /api/briefs ok', put.ok(), `status ${put.status()}`)
  await openBriefTab(slug)
  ok('card now lists 2 items', (await page.locator('[data-testid=open-questions] li').count()) === 2)
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await dashboardCard().waitFor({ timeout: 15000 })
  ok('dashboard card shows "2 for Mara"', ((await dashboardCard().textContent()) || '').includes('2 for Mara'))
  await page.screenshot({ path: `${shotDir}/smoke-220-dashboard-2.png` })
} catch (e) {
  ok('script ran without error', false, String(e.message).split('\n')[0])
}

await browser.close()
const failed = results.filter((r) => !r.pass).length
console.log(failed ? `\n${failed} FAILED` : `\nALL PASS ${results.length}/${results.length}`)
process.exit(failed ? 1 : 0)
