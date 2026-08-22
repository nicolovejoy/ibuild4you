#!/usr/bin/env node
/**
 * Revoke ONE Garm grant on the ibuild4you project by hand. Ops tool for the
 * rare case where a grant must be cleared before Garm will alias an address
 * (Garm 409s an alias whose presented address still holds an active grant).
 *
 * Usage (admin key injected by 1Password, never written to disk):
 *   op run --env-file=.env.ops.tpl -- node scripts/garm-revoke-grant.mjs <email>          # dry run: show current grants for the address
 *   op run --env-file=.env.ops.tpl -- node scripts/garm-revoke-grant.mjs <email> --apply  # revoke, then re-list to confirm
 *
 * Same DELETE shape as lib/garm-grants.ts revokeGrant(), actor `nico` so the
 * audit row says a human did it.
 */
const email = (process.argv[2] || '').trim().toLowerCase()
const apply = process.argv.includes('--apply')
const url = process.env.GARM_URL
const key = process.env.GARM_ADMIN_KEY
const project = 'ibuild4you'

if (!email || !email.includes('@')) {
  console.error('usage: garm-revoke-grant.mjs <email> [--apply]')
  process.exit(2)
}
if (!url || !key) {
  console.error('GARM_URL / GARM_ADMIN_KEY missing — run under `op run --env-file=.env.ops.tpl -- …`')
  process.exit(2)
}

const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` }

async function listForEmail() {
  const res = await fetch(`${url}/api/grants?project=${project}`, { headers })
  if (!res.ok) throw new Error(`GET /api/grants ${res.status}`)
  const body = await res.json()
  const grants = Array.isArray(body?.grants) ? body.grants : null
  if (!grants) throw new Error('unexpected listing shape (expected {grants:[...]})')
  return grants.filter((g) => String(g.email || '').toLowerCase() === email)
}

const before = await listForEmail()
console.log(`active grants for that address on ${project}: ${before.length}`)
for (const g of before) console.log(`  role=${g.role} actor=${g.actor ?? '?'} created=${g.created_at ?? '?'}`)

if (!apply) {
  console.log(before.length ? 'dry run — re-run with --apply to revoke' : 'nothing to revoke')
  process.exit(0)
}
if (!before.length) process.exit(0)

const res = await fetch(`${url}/api/grants`, {
  method: 'DELETE',
  headers,
  body: JSON.stringify({ email, project, actor: 'nico' }),
})
console.log(`DELETE /api/grants → ${res.status}`)
if (!res.ok) {
  console.error(await res.text())
  process.exit(1)
}
const after = await listForEmail()
console.log(`active grants after: ${after.length}${after.length ? '  ⚠️ still present' : '  ✅ revoked'}`)
process.exit(after.length ? 1 : 0)
