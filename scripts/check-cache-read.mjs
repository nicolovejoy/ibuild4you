#!/usr/bin/env node
// Print api_usage rows for a chat session (newest last) so we can confirm
// cache_read_input_tokens > 0 on turn 2+ (the #38 cache assertion).
//
// Usage: node scripts/with-preview-env.mjs node scripts/check-cache-read.mjs <session_id>

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const sessionId = process.argv[2]
if (!sessionId) {
  console.error('Usage: ... check-cache-read.mjs <session_id>')
  process.exit(1)
}
const sa = process.env.FIREBASE_SERVICE_ACCOUNT
if (!sa) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT (use scripts/with-preview-env.mjs)')
  process.exit(1)
}
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) })
const db = getFirestore()

const snap = await db
  .collection('api_usage')
  .where('session_id', '==', sessionId)
  .where('route', '==', 'chat')
  .get()

const rows = snap.docs.map((d) => d.data()).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
if (!rows.length) {
  console.log(`No chat api_usage rows for session ${sessionId}`)
  process.exit(1)
}
console.log(`chat api_usage for session ${sessionId} (oldest→newest):`)
rows.forEach((r, i) => {
  console.log(`  turn ${i + 1}: input=${r.input_tokens} cache_read=${r.cache_read_input_tokens} cache_create=${r.cache_creation_input_tokens} out=${r.output_tokens}`)
})
const laterHit = rows.slice(1).some((r) => (r.cache_read_input_tokens ?? 0) > 0)
console.log(laterHit ? '\n✅ cache_read > 0 on a turn 2+' : '\n⚠️ no cache_read hit on later turns (review)')
process.exit(laterHit ? 0 : 1)
