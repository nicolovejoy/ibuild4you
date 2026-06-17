import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { buildDigest, type DigestItem } from '@/lib/api/notify-digest'
import { getServerShareLink } from '@/lib/url'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { getMakerShortName } from '@/lib/copy'
import { Resend } from 'resend'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

// Daily cron (see vercel.json). Sends ONE cross-brief digest listing every
// brief with maker activity waiting on the builder, then clears the pending
// markers — replacing the old per-brief-per-burst spam (#65). The */5
// /api/cron/notify cron no longer emails; it only sets these markers (via
// /api/chat) and runs idle brief regen.
//
// "Pending" = notify_pending_since is set (cleared once a digest goes out).
// We query on that rather than the old notify_after debounce window so a daily
// run catches everything, including messages from the last few minutes.
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  // All ISO strings sort after '' — so `> ''` selects docs where the field is a
  // non-empty string and excludes null/missing.
  const pendingSnap = await db
    .collection('projects')
    .where('notify_pending_since', '>', '')
    .get()

  if (pendingSnap.empty) {
    return NextResponse.json({ sent: false, checked: 0, briefs: 0 })
  }

  const items: DigestItem[] = pendingSnap.docs.map((doc) => {
    const data = doc.data()
    return {
      title: (data.title as string) || 'Untitled project',
      url: getServerShareLink((data.slug as string) || doc.id),
      makerName: getMakerShortName(
        data.requester_first_name as string | undefined,
        data.requester_email as string | undefined,
        'the maker'
      ),
      pendingSince: data.notify_pending_since as string | undefined,
    }
  })

  const digest = buildDigest(items)
  if (!digest) {
    return NextResponse.json({ sent: false, checked: pendingSnap.size, briefs: 0 })
  }

  try {
    await getResend().emails.send({
      from: 'iBuild4you <noreply@ibuild4you.com>',
      to: NOTIFICATION_EMAILS,
      subject: digest.subject,
      text: digest.text,
    })
  } catch (err) {
    console.error('[cron/notify-digest] send failed:', err)
    return NextResponse.json({ error: 'send_failed' }, { status: 500 })
  }

  // Clear pending markers only after a successful send, so a failed send retries
  // the same briefs on the next run rather than dropping them.
  const batch = db.batch()
  for (const doc of pendingSnap.docs) {
    batch.update(doc.ref, {
      notify_after: null,
      notify_pending_since: null,
      notify_last_sent_at: now,
    })
  }
  await batch.commit()

  return NextResponse.json({ sent: true, checked: pendingSnap.size, briefs: items.length })
}
