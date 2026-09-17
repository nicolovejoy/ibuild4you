#!/usr/bin/env node
// READ-ONLY. Dump everything that decides "can this person open this brief's
// conversation": the project's config, its members, their approved_emails rows,
// its sessions (with message counts), and recent Garm sign-in denials.
//
// Usage (read-only key, injected from 1Password — the laptop's .env.local
// service account is incomplete, so with-prod-env.mjs alone fails here):
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/inspect-project.mjs --recent 5
//   ... --grep cafe
//   ... --project <id>
import { createHash } from 'node:crypto'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('No FIREBASE_SERVICE_ACCOUNT (run via with-prod-env.mjs)'); process.exit(1) }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const sha = (s) => createHash('sha256').update(s).digest('hex')
const short = (v, n = 70) => (typeof v === 'string' ? (v.length > n ? v.slice(0, n) + '…' : v) : v)

// Pick the project(s): explicit id, substring match, or N most recently created.
const all = (await db.collection('projects').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
let picked
if (arg('project')) {
  picked = all.filter((p) => p.id === arg('project'))
} else if (arg('grep')) {
  const g = arg('grep').toLowerCase()
  picked = all.filter((p) => `${p.slug} ${p.title}`.toLowerCase().includes(g))
} else {
  const n = Number(arg('recent') || 3)
  picked = all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, n)
}
if (!picked.length) { console.error('No matching project'); process.exit(1) }

for (const p of picked) {
  console.log(`\n=== ${p.title}  (slug ${p.slug}, id ${p.id}) ===`)
  console.log(`created_at ${p.created_at}  session_count ${p.session_count}  latest_session ${p.latest_session_created_at}`)
  console.log(`requester: ${p.requester_first_name || ''} ${p.requester_last_name || ''} <${p.requester_email || ''}>`)
  console.log(`session_mode ${p.session_mode}  shared_at ${p.shared_at || '-'}  archived_at ${p.archived_at || '-'}`)
  console.log(`welcome_message: ${short(p.welcome_message)}`)
  // Every other top-level key, by type — catches a payload field of the wrong shape.
  const shapes = Object.entries(p)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v}`)
  console.log(`field shapes: ${shapes.join('  ')}`)

  const members = (await db.collection('project_members').where('project_id', '==', p.id).get()).docs
  console.log(`\nmembers (${members.length}):`)
  for (const m of members) {
    const d = m.data()
    const email = d.email || ''
    const approved = email ? await db.collection('approved_emails').doc(email).get() : null
    const denial = email ? await db.collection('garm_denials').doc(sha(email)).get() : null
    const weird = email !== email.trim().toLowerCase() ? '  ⚠ NOT NORMALIZED' : ''
    console.log(
      `  ${JSON.stringify(email)}${weird}  role=${d.role} brief_role=${d.brief_role}` +
      `  claimed=${d.user_id ? 'yes' : 'no'}  removed=${d.removed_at ? 'yes' : 'no'}` +
      `  approved=${approved?.exists ? (approved.data().revoked_at ? 'REVOKED' : 'yes') : 'NO'}` +
      `  garm_denials=${denial?.exists ? `${denial.data().count} (${denial.data().kind}, last ${denial.data().last_seen})` : '0'}`
    )
  }

  const sessions = (await db.collection('sessions').where('project_id', '==', p.id).get()).docs
    .sort((a, b) => String(a.data().created_at).localeCompare(String(b.data().created_at)))
  console.log(`\nsessions (${sessions.length}):`)
  for (const s of sessions) {
    const d = s.data()
    const msgs = (await db.collection('messages').where('session_id', '==', s.id).get()).docs
      .map((m) => m.data())
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    const last = msgs.at(-1)
    console.log(`  ${s.id}  status=${d.status}  created ${d.created_at}  mode=${d.session_mode}  messages=${msgs.length}`)
    if (last) console.log(`      last: [${last.role}] ${last.created_at}  ${short(last.content, 90)}`)
  }
}

// Sign-in denials in the last 48h (counts + kind only; docs hold no addresses).
const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
const denials = (await db.collection('garm_denials').where('last_seen', '>=', since).get()).docs
console.log(`\nGarm sign-in denials, last 48h: ${denials.length}`)
for (const d of denials) {
  const x = d.data()
  console.log(`  ${x.kind}  count=${x.count}  first ${x.first_seen}  last ${x.last_seen}`)
}
