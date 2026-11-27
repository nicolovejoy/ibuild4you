// READ-ONLY. Drafts the "new conversation" invitation for real briefs with the
// current prep prompt, without saving anything, so a person can read the drafts
// before a prompt change ships. Each brief is drafted with the previous
// conversation's messages and without them, to see what the recap adds.
//
// It calls the model (a few cents a run) and writes nothing to Firestore.
//
// Usage (vite-node resolves the @/ alias through vitest.config.ts):
//   EVAL_ANTHROPIC_API_KEY=op://vault/item/field op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs npx vite-node --config vitest.config.ts scripts/eval-prep-draft.ts -- --slugs bill-duris-musicforge-feedback,stem-karaoke --runs 3
// (op run resolves an op:// value given on the command line too.)
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { generatePrepOutbound, type PrepInput } from '@/lib/agent/prep-outbound'
import { joinNames } from '@/lib/names'
import { toLocale } from '@/lib/locale'
import type { BriefContent } from '@/lib/types'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const slugs = (arg('slugs') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const runs = Number(arg('runs') || 3)
if (!slugs.length) {
  console.error('Pass --slugs a,b,c (a slug or part of a title each)')
  process.exit(1)
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('No FIREBASE_SERVICE_ACCOUNT (run via with-prod-env-ro.mjs)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

// Wording the rules forbid, flagged for the reader. Not used by the app.
const SUSPECT = /minute|\bmin\b|quick|moment|chance|no rush|thank|excit|great|!/i
const sentences = (t: string) => t.split(/(?<=[.?!])\s+/).filter(Boolean).length

const projects = (await db.collection('projects').get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string })

// The with-prod-env-ro wrapper lays the local env file over the environment, so
// a key passed as ANTHROPIC_API_KEY loses to the local one. EVAL_ANTHROPIC_API_KEY
// is not in that file, so it survives the wrapper.
if (process.env.EVAL_ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = process.env.EVAL_ANTHROPIC_API_KEY

for (const needle of slugs) {
  // An exact slug wins; otherwise a part of the slug or title.
  const exact = projects.filter((p) => String(p.slug).toLowerCase() === needle)
  const matches = exact.length ? exact : projects.filter((p) => `${p.slug} ${p.title}`.toLowerCase().includes(needle))
  if (matches.length !== 1) {
    const list = matches.length ? matches : projects
    console.log(`\n"${needle}": ${matches.length} matches. ${matches.length ? 'Matches' : 'All slugs'}: ${list.map((p) => p.slug).join(', ')}`)
    continue
  }
  const p = matches[0]

  // Same inputs the prep route builds (app/api/projects/[id]/prep/generate/route.ts).
  const briefSnap = await db.collection('briefs').where('project_id', '==', p.id).orderBy('version', 'desc').limit(1).get()
  const brief = briefSnap.empty ? null : (briefSnap.docs[0].data().content as BriefContent)

  const makerSnap = await db.collection('project_members').where('project_id', '==', p.id).where('role', '==', 'maker').get()
  const firstNames: string[] = []
  for (const doc of makerSnap.docs) {
    const d = doc.data()
    if (d.removed_at || !d.email) continue
    const user = d.user_id ? (await db.collection('users').doc(d.user_id as string).get()).data() : undefined
    firstNames.push((user?.first_name as string | undefined) || (d.email as string).split('@')[0])
  }
  const makerNames = firstNames.length ? joinNames(firstNames) : ((p.requester_first_name as string | undefined) ?? null)

  const input: PrepInput = {
    projectTitle: (p.title as string) || 'your brief',
    makerNames,
    brief,
    sessionMode: (p.session_mode as 'discover' | 'converge' | undefined) ?? 'discover',
    seedQuestions: (p.seed_questions as string[] | undefined) ?? [],
    builderDirectives: (p.builder_directives as string[] | undefined) ?? [],
    welcomeMessage: (p.welcome_message as string | undefined) ?? null,
    language: toLocale(p.language),
  }

  const lastSession = await db.collection('sessions').where('project_id', '==', p.id).orderBy('created_at', 'desc').limit(1).get()
  let recap: { role: string; content: string }[] = []
  if (!lastSession.empty) {
    const msgs = await db.collection('messages').where('session_id', '==', lastSession.docs[0].id).orderBy('created_at', 'asc').get()
    recap = msgs.docs.map((m) => ({ role: m.data().role as string, content: (m.data().content as string) || '' }))
  }

  console.log(`\n=== ${p.title} (${p.slug}, ${input.language}, ${input.sessionMode}) ===`)
  console.log(`Makers: ${makerNames || '(none)'}`)
  console.log(`Welcome message: ${(input.welcomeMessage || '(none)').replace(/\s+/g, ' ').slice(0, 400)}`)
  console.log(`Stored draft now: ${String(p.prep_nudge || '(none)').replace(/\s+/g, ' ')}`)

  for (const [label, withRecap] of [['with last conversation', true], ['without last conversation', false]] as const) {
    console.log(`\n  -- ${label} --`)
    for (let i = 0; i < runs; i++) {
      try {
        const out = await generatePrepOutbound({ ...input, lastSessionMessages: withRecap ? recap : [] })
        const flags = [SUSPECT.test(out.nudge_message) ? 'SUSPECT WORDING' : '', sentences(out.nudge_message) > 2 ? 'OVER 2 SENTENCES' : '']
          .filter(Boolean)
          .join(', ')
        console.log(`  ${i + 1}. ${out.nudge_message}${flags ? `   [${flags}]` : ''}`)
      } catch (err) {
        console.log(`  ${i + 1}. failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}
process.exit(0)
