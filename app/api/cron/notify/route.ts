import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { Resend } from 'resend'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

// Every 5 min (see vercel.json). Finds projects where notify_after has passed,
// sends one digest email per project, and clears the pending flags.
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  const readySnap = await db
    .collection('projects')
    .where('notify_after', '<', now)
    .get()

  let sent = 0
  const errors: string[] = []

  for (const doc of readySnap.docs) {
    const data = doc.data()
    const projectId = doc.id
    const title = (data.title as string) || 'Untitled project'
    const slug = (data.slug as string) || projectId
    const makerName =
      (data.requester_first_name as string) ||
      (data.requester_email as string | undefined)?.split('@')[0] ||
      'the maker'
    const pendingSince = data.notify_pending_since as string | undefined
    const subject = `New messages from ${makerName} in ${title}`
    const body = [
      `${makerName} has new messages in "${title}".`,
      pendingSince ? `First unread message at ${pendingSince}.` : '',
      '',
      `Open project: https://ibuild4you.com/projects/${slug}`,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      await getResend().emails.send({
        from: 'iBuild4you <noreply@ibuild4you.com>',
        to: NOTIFICATION_EMAILS,
        subject,
        text: body,
      })
      sent++
    } catch (err) {
      console.error(`[cron/notify] send failed for project ${projectId}:`, err)
      errors.push(projectId)
      continue
    }

    await doc.ref.update({
      notify_after: null,
      notify_pending_since: null,
      notify_last_sent_at: now,
    })
  }

  return NextResponse.json({ sent, errors, checked: readySnap.size })
}
