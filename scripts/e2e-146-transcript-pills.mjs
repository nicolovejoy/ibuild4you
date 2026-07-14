// #146 preview e2e — builder transcript overflow visibility (v2: persistent
// box + always-visible scrollbar; the v1 disappearing pills left the reader
// blind between reveals). Seeds a brief with a long conversation, opens the
// builder Conversations tab, and checks the pane is boxed, scrollable, and
// auto-scrolled to the newest message with overflow above.
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

const info = await page.evaluate(() => {
  const pane = document.querySelector('.scrollbar-visible')
  if (!pane) return null
  const style = getComputedStyle(pane)
  return {
    bubbles: pane.children.length,
    overflows: pane.scrollHeight > pane.clientHeight + 10,
    atBottom: pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 5,
    boxed: style.borderStyle !== 'none' && parseFloat(style.borderWidth) > 0,
    scrollbarStyled: style.scrollbarWidth === 'thin' || style.scrollbarColor !== 'auto',
  }
})
check('1. pane present with scrollbar-visible class', !!info)
check('2. all 14 messages rendered', info?.bubbles === 14)
check('3. transcript overflows the pane', !!info?.overflows)
check('4. auto-scrolled to the newest message', !!info?.atBottom)
check('5. pane is visibly boxed (border)', !!info?.boxed)
check('6. scrollbar opts out of the macOS overlay style', !!info?.scrollbarStyled)

await browser.close()
await cleanAll(db, { scenario: SCENARIO })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
