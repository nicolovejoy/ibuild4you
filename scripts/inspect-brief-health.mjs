#!/usr/bin/env node
// READ-ONLY. Why did a brief stop updating, and why does the agent keep
// greeting? Dumps one project's regen breaker state, brief + version history
// (with size), per-session message timeline (role/kind/length, no content), and
// its api_usage rows by route (output_tokens near BRIEF_MAX_TOKENS = truncation).
//
// Usage:
//   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/inspect-brief-health.mjs --slug f4fc
//   ... --project <id>
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('No FIREBASE_SERVICE_ACCOUNT (run via with-prod-env-ro.mjs)'); process.exit(1) }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const all = (await db.collection('projects').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const slug = arg('slug')?.toLowerCase()
const picked = arg('project')
  ? all.filter((p) => p.id === arg('project'))
  : all.filter((p) => String(p.slug || '').toLowerCase() === slug ||
      `${p.slug} ${p.title}`.toLowerCase().includes(slug || '\u0000'))
if (!picked.length) { console.error('No matching project'); process.exit(1) }
if (picked.length > 1) {
  console.error('Several match, rerun with --project <id>:')
  for (const p of picked) console.error(`  ${p.id}  ${p.slug}  ${p.title}`)
  process.exit(1)
}
const p = picked[0]
const len = (v) => (v == null ? 0 : JSON.stringify(v).length)
const count = (v) => (Array.isArray(v) ? v.length : v == null ? '-' : typeof v)

console.log(`=== ${p.title}  (slug ${p.slug}, id ${p.id}) ===`)
console.log(`session_mode ${p.session_mode}  session_count ${p.session_count}  language ${p.language || 'en'}`)
console.log(`builder_directives ${count(p.builder_directives)}  seed_questions ${count(p.seed_questions)}  context ${len(p.context)} chars`)
console.log(`welcome_message ${len(p.welcome_message)} chars  nudge_message ${len(p.nudge_message)} chars`)
console.log(`last_maker_message_at ${p.last_maker_message_at}`)
console.log(`maker_waiting_since ${p.maker_waiting_since ?? '-'}`)
console.log(`prep_copied_at ${p.prep_copied_at ?? '-'}  payload_pasted_at ${p.payload_pasted_at ?? '-'}  payload_pasted_version ${p.payload_pasted_version ?? '-'}`)
console.log(`brief_regen_failures ${p.brief_regen_failures ?? 0}  since ${p.brief_regen_failures_since ?? '-'}`)
console.log(`brief_regen_last_error ${p.brief_regen_last_error ?? '-'}  at ${p.brief_regen_last_error_at ?? '-'}`)

const briefs = (await db.collection('briefs').where('project_id', '==', p.id).get()).docs
console.log(`\nbriefs (${briefs.length}):`)
for (const b of briefs) {
  const d = b.data()
  const c = d.content || {}
  console.log(`  ${b.id}  version ${d.version}  source ${d.source ?? '-'}  updated_at ${d.updated_at}  size ${len(c)} chars`)
  console.log(`    decisions ${count(c.decisions)} (locked ${(c.decisions || []).filter((x) => x?.locked).length})  features ${count(c.features)}  open_risks ${count(c.open_risks)}  keys ${Object.keys(c).join(',')}`)
  const versions = (await b.ref.collection('versions').get()).docs.map((v) => v.data())
    .sort((a, b2) => (a.version ?? 0) - (b2.version ?? 0))
  for (const v of versions) {
    console.log(`    v${v.version}  source ${v.source ?? '-'}  updated_at ${v.updated_at}  archived_at ${v.archived_at}  size ${len(v.content)}  decisions ${count(v.content?.decisions)}`)
  }
}

const sessions = (await db.collection('sessions').where('project_id', '==', p.id).get()).docs
  .sort((a, b) => String(a.data().created_at).localeCompare(String(b.data().created_at)))
console.log(`\nsessions (${sessions.length}):`)
for (const s of sessions) {
  const d = s.data()
  console.log(`  ${s.id}  status=${d.status}  created ${d.created_at}  mode=${d.session_mode}  directives ${count(d.builder_directives)}  welcome ${len(d.welcome_message)} chars`)
  const msgs = (await db.collection('messages').where('session_id', '==', s.id).get()).docs
    .map((m) => m.data())
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  for (const m of msgs) {
    console.log(`    ${m.created_at}  ${m.role}${m.kind ? `/${m.kind}` : ''}  ${len(m.content)} chars${m.sender_email ? '  (named sender)' : ''}`)
  }
}

const usage = (await db.collection('api_usage').where('project_id', '==', p.id).get()).docs
  .map((u) => u.data())
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
console.log(`\napi_usage (${usage.length}):`)
for (const u of usage) {
  if (u.route === 'chat') continue
  console.log(`  ${u.created_at}  ${u.route}  ${u.model}  in ${(u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)} (cache read ${u.cache_read_input_tokens || 0})  out ${u.output_tokens}  ${u.duration_ms != null ? `${(u.duration_ms / 1000).toFixed(1)}s` : '-'}  $${Number(u.cost_usd || 0).toFixed(3)}`)
}
console.log(`  (chat turns omitted: ${usage.filter((u) => u.route === 'chat').length})`)
