// #146 preview e2e — builder transcript scroll-affordance pills.
// Seeds a brief with a long conversation, opens the builder Conversations tab,
// and checks: pill on load, hides on scroll, returns after the idle spell,
// click scrolls to top (revealing a "later" pill).
//
// Run: node scripts/with-preview-env.mjs node scripts/e2e-146-transcript-pills.mjs
import { initFixtureDb, makeProject, addSession, addMessage, cleanAll } from './fixtures/db.mjs'
import { launchLoggedIn } from './lib/preview-login.mjs'

const SCENARIO = 'e2e-146-pills'
const { db } = initFixtureDb({ requireWrite: true })

// Fresh seed each run
await cleanAll(db, { scenario: SCENARIO })
const projectId = await makeProject(
  db,
  { title: 'Pills 146 Fixture', slug: `pills-146-fixture-${Date.now()}`, requester_email: 'test@ibuild4you.com' },
  SCENARIO
)
const sessionId = await addSession(db, projectId, { status: 'active' }, SCENARIO)
for (let i = 0; i < 14; i++) {
  await addMessage(
    db,
    sessionId,
    {
      role: i % 2 ? 'user' : 'agent',
      content: `Fixture message ${i + 1} — enough words to give the bubble some height in the pane so the transcript overflows comfortably.`,
      created_at: new Date(Date.now() - (14 - i) * 60000).toISOString(),
    },
    SCENARIO
  )
}
const projectDoc = await db.collection('projects').doc(projectId).get()
const slug = projectDoc.data().slug
console.log('seeded', { projectId, sessionId, slug })

let pass = 0
let fail = 0
const check = (name, ok) => {
  console.log(ok ? `✅ ${name}` : `❌ ${name}`)
  ok ? pass++ : fail++
}

const { browser, page, BASE } = await launchLoggedIn()
await page.goto(`${BASE}/projects/${slug}?session=${sessionId}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const pill = page.getByRole('button', { name: /earlier message/ })
check('1. top pill visible on load', await pill.isVisible().catch(() => false))
const pillText = (await pill.textContent().catch(() => '')) || ''
check('2. pill counts hidden messages', /↑ \d+ earlier messages/.test(pillText))

// Scroll a little inside the pane → pills hide
await page.evaluate(() => {
  const pane = document.querySelector('.max-h-\\[65vh\\].overflow-y-auto')
  pane.scrollTop -= 120
  pane.dispatchEvent(new Event('scroll'))
})
await page.waitForTimeout(500)
check('3. pill hides while scrolling', !(await pill.isVisible().catch(() => false)))

// Stay still past the idle window → pills return, both directions now
await page.waitForTimeout(10_500)
check('4. pill returns after idle spell', await pill.isVisible().catch(() => false))
const laterPill = page.getByRole('button', { name: /later message/ })
check('5. bottom (later) pill also shows mid-scroll', await laterPill.isVisible().catch(() => false))

// Click the top pill → scrolls to the first message
await pill.click()
await page.waitForTimeout(2000)
const atTop = await page.evaluate(() => {
  const pane = document.querySelector('.max-h-\\[65vh\\].overflow-y-auto')
  return pane.scrollTop < 5
})
check('6. clicking the pill scrolls to the top', atTop)

await browser.close()
await cleanAll(db, { scenario: SCENARIO })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
