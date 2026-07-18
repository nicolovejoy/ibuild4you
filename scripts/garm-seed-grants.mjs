#!/usr/bin/env node
// Garm 2/4 — one-time (re-runnable) seed of app-level Garm grants for the
// `ibuild4you` project, from current live membership. Dry-run by default.
//
// Reads Firestore (approved_emails, project_members, users) READ-ONLY via the
// with-prod-env-ro wrapper. Writes only to Garm, never to Firestore.
//
// Role-collapse rule (confirmed with Nico, docs/garm-2-seed-plan.md): a person
// can hold different MemberRoles across briefs; Garm's project is app-level,
// so the highest active brief role wins, mapped down to Garm's 3 tiers.
// System admins always resolve to owner. See scripts/lib/garm-seed-plan.mjs.
//
// Usage:
//   node scripts/with-prod-env-ro.mjs node scripts/garm-seed-grants.mjs            # dry-run
//   GARM_ADMIN_KEY=$(op read "op://dev-secrets/garm/password") \
//     node scripts/with-prod-env-ro.mjs node scripts/garm-seed-grants.mjs --live   # write to Garm

import { initAdminDb } from './fixtures/db.mjs'
import { buildGrantPlan, selectActiveApprovedEmails } from './lib/garm-seed-plan.mjs'

const LIVE = process.argv.includes('--live')
const PROJECT = 'ibuild4you'

// Mirrors lib/constants.ts ADMIN_EMAILS — kept as a plain literal here since
// this script can't import a .ts module (no TS runner is wired for scripts;
// see scripts/lib/garm-seed-plan.mjs for the same convention).
const HARDCODED_ADMIN_EMAILS = ['nicholas.lovejoy@gmail.com', 'mlovejoy@scu.edu', 'nlovejoy@me.com']

const GARM_URL = process.env.GARM_URL || 'https://garm.prompt-labs.org'
const GARM_ADMIN_KEY = process.env.GARM_ADMIN_KEY

if (LIVE && !GARM_ADMIN_KEY) {
  console.error('Refusing --live: GARM_ADMIN_KEY not set.')
  console.error('Inject it yourself: export GARM_ADMIN_KEY=$(op read "op://dev-secrets/garm/password")')
  process.exit(1)
}

const { db } = initAdminDb()

// Basic shape guard — Garm has never seen this data before, so don't hand it
// garbage. Live prod `approved_emails` has at least one placeholder string doc
// and one missing-TLD typo; skip anything that doesn't look like an email
// rather than silently seeding a bogus grant.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function validEmails(emails, label) {
  const good = []
  for (const e of emails) {
    if (EMAIL_RE.test(e ?? '')) good.push(e)
    else console.warn(`[garm-seed] skipping malformed ${label} entry: ${JSON.stringify(e)}`)
  }
  return good
}

async function loadApprovedEmails() {
  const snap = await db.collection('approved_emails').get()
  const docs = snap.docs.map((d) => ({ id: d.id, email: d.data().email, revoked_at: d.data().revoked_at }))
  return validEmails(selectActiveApprovedEmails(docs), 'approved_emails')
}

async function loadMembers() {
  const snap = await db.collection('project_members').get()
  const rows = snap.docs.map((d) => {
    const data = d.data()
    return { email: data.email, role: data.role, removed_at: data.removed_at ?? null }
  })
  const goodEmails = new Set(validEmails(rows.map((r) => r.email), 'project_members'))
  return rows.filter((r) => goodEmails.has(r.email))
}

async function loadSystemAdminEmails() {
  const snap = await db.collection('users').where('system_roles', 'array-contains', 'admin').get()
  return snap.docs.map((d) => d.data().email).filter(Boolean)
}

async function postGrant({ email, role }) {
  const res = await fetch(`${GARM_URL}/api/grants`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${GARM_ADMIN_KEY}`,
    },
    body: JSON.stringify({ email, project: PROJECT, role, actor: 'seed-script' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`POST /api/grants ${res.status} for ${email}: ${body}`)
  }
}

async function fetchActiveGrantCount() {
  const res = await fetch(`${GARM_URL}/api/grants?project=${PROJECT}`, {
    headers: { authorization: `Bearer ${GARM_ADMIN_KEY}` },
  })
  if (!res.ok) throw new Error(`GET /api/grants ${res.status}`)
  const data = await res.json()
  return Array.isArray(data?.grants) ? data.grants.length : Array.isArray(data) ? data.length : NaN
}

async function main() {
  const [approvedEmails, members, systemAdminEmails] = await Promise.all([
    loadApprovedEmails(),
    loadMembers(),
    loadSystemAdminEmails(),
  ])

  const plan = buildGrantPlan({
    approvedEmails,
    members,
    adminEmails: HARDCODED_ADMIN_EMAILS,
    systemAdminEmails,
  })

  console.log(LIVE ? '=== GARM SEED (LIVE) ===' : '=== GARM SEED (DRY RUN) ===')
  console.log(`project: ${PROJECT}  grants: ${plan.length}\n`)
  const width = Math.max(...plan.map((g) => g.email.length), 5)
  for (const g of plan) {
    console.log(`${g.email.padEnd(width)}  ${g.role}`)
  }

  if (!LIVE) {
    console.log('\nDry run only — pass --live to write these grants to Garm.')
    return
  }

  console.log('\nPosting grants to Garm...')
  let ok = 0
  for (const grant of plan) {
    await postGrant(grant)
    ok++
  }
  console.log(`Posted ${ok}/${plan.length} grants.`)

  const activeCount = await fetchActiveGrantCount()
  if (activeCount === plan.length) {
    console.log(`PASS — GET /api/grants?project=${PROJECT} reports ${activeCount} active grants, matches plan.`)
  } else {
    console.error(`FAIL — GET /api/grants?project=${PROJECT} reports ${activeCount} active grants, expected ${plan.length}.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
