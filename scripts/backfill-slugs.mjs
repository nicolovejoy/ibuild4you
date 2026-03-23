#!/usr/bin/env node
// Backfill slugs for existing projects that don't have one.
//
// Run: export FIREBASE_SERVICE_ACCOUNT=$(grep FIREBASE_SERVICE_ACCOUNT .env.local | cut -d= -f2-) && node scripts/backfill-slugs.mjs

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
if (!serviceAccount) {
  console.error('Set FIREBASE_SERVICE_ACCOUNT env var first.')
  process.exit(1)
}

initializeApp({ credential: cert(JSON.parse(serviceAccount)) })
const db = getFirestore()

function generateSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

async function ensureUnique(slug, excludeId) {
  let candidate = slug
  let suffix = 1
  while (true) {
    const existing = await db.collection('projects').where('slug', '==', candidate).limit(1).get()
    if (existing.empty) return candidate
    if (excludeId && existing.docs[0].id === excludeId) return candidate
    suffix++
    candidate = `${slug}-${suffix}`
  }
}

const snap = await db.collection('projects').get()
let updated = 0
let skipped = 0

for (const doc of snap.docs) {
  const data = doc.data()
  if (data.slug) {
    skipped++
    continue
  }

  const title = data.title || 'untitled'
  const slug = await ensureUnique(generateSlug(title), doc.id)
  await doc.ref.update({ slug })
  console.log(`${doc.id}: "${title}" → ${slug}`)
  updated++
}

console.log(`\nDone. Updated: ${updated}, Skipped (already had slug): ${skipped}`)
