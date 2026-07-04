import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { captureExpiryCutoffIso, selectExpirable } from '@/lib/api/capture-retention'

// #72 slice B6 — daily cron (see vercel.json). Flags prototype_context rows
// older than the retention window with status: 'expired'. A flag, not a delete
// (house rule) — expired rows stop feeding the agent prompt and admin views but
// stay queryable.
//
// The query is range-only on created_at (single-field auto index); the status
// filter happens in code via selectExpirable, which keeps us off a second
// composite index for a collection this small.
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()

  const snap = await db
    .collection('prototype_context')
    .where('created_at', '<', captureExpiryCutoffIso(nowMs))
    .limit(400) // safety cap; anything left picks up on the next daily run
    .get()

  const rows = snap.docs.map((d) => ({
    id: d.id,
    status: d.data().status as string | undefined,
    created_at: d.data().created_at as string | undefined,
  }))
  const expirable = selectExpirable(rows, nowMs)

  if (expirable.length === 0) {
    return NextResponse.json({ expired: 0, checked: snap.size })
  }

  const batch = db.batch()
  for (const id of expirable) {
    batch.update(db.collection('prototype_context').doc(id), {
      status: 'expired',
      updated_at: now,
    })
  }
  await batch.commit()

  return NextResponse.json({ expired: expirable.length, checked: snap.size })
}
