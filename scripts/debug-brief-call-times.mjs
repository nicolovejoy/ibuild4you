#!/usr/bin/env node
// Distribution of brief.generate timestamps for a given project — is it
// every-5-min like the cron, or bursty?

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1) }
initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const projectId = process.argv[2]
if (!projectId) { console.error('Usage: ... <project_id>'); process.exit(1) }

const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
// No composite index on (project_id, created_at) — filter client-side
const snap = await db
  .collection('api_usage')
  .where('created_at', '>=', since)
  .get()

const rows = snap.docs
  .map((d) => d.data())
  .filter((r) => r.route === 'brief.generate' && r.project_id === projectId)
  .sort((a, b) => a.created_at.localeCompare(b.created_at))

console.log(`${rows.length} brief.generate calls for ${projectId} in 24h\n`)

// Show most recent 30 calls
const last30 = rows.slice(-30)
let prev = rows.length > 30 ? rows[rows.length - 31].created_at : null
for (const r of last30) {
  const gap = prev ? ((new Date(r.created_at).getTime() - new Date(prev).getTime()) / 1000).toFixed(0) + 's' : '-'
  console.log(`${r.created_at}  gap=${gap.padStart(6)}  in=${String(r.input_tokens).padStart(5)} out=${String(r.output_tokens).padStart(4)}  dur=${r.duration_ms}ms`)
  prev = r.created_at
}

process.exit(0)
