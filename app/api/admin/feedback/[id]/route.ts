import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getAuthenticatedUser, getAdminDb } from '@/lib/api/firebase-server-helpers'
import { requireFeedbackAccess } from '@/lib/api/feedback-access'
import { feedbackReplyAddress } from '@/lib/feedback/inbound'
import type { FeedbackStatus } from '@/lib/types'

const ALLOWED_STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'in_progress', 'done', 'wontfix', 'spam']

// Statuses that trigger an outbound email to the submitter (if they left one).
// "acknowledged" tells them we heard them; "done" closes the loop.
const NOTIFY_ON: FeedbackStatus[] = ['acknowledged', 'done']

// PATCH /api/admin/feedback/[id] — admins and collaborators+ on the row's app: update status / internal_notes /
// github_issue_url. Sends a submitter notification on acknowledged/done.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getAdminDb()
  const ref = db.collection('feedback').doc(id)
  const snap = await ref.get()
  if (!snap.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const existing = snap.data()!
  const denied = await requireFeedbackAccess(auth, existing.project_id as string)
  if (denied) return denied

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('status' in body) {
    const s = body.status
    if (typeof s !== 'string' || !ALLOWED_STATUSES.includes(s as FeedbackStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    patch.status = s
  }
  if ('internal_notes' in body) {
    const n = body.internal_notes
    if (n !== null && typeof n !== 'string') {
      return NextResponse.json({ error: 'internal_notes must be string or null' }, { status: 400 })
    }
    patch.internal_notes = n
  }
  if ('github_issue_url' in body) {
    const u = body.github_issue_url
    if (u !== null && typeof u !== 'string') {
      return NextResponse.json({ error: 'github_issue_url must be string or null' }, { status: 400 })
    }
    // The inbox renders this as a link, so only a real GitHub URL is accepted.
    if (u !== null && !/^https:\/\/github\.com\//.test(u)) {
      return NextResponse.json(
        { error: 'github_issue_url must be a https://github.com/ URL' },
        { status: 400 }
      )
    }
    patch.github_issue_url = u
  }

  await ref.update(patch)

  // Notify submitter on first transition into acknowledged/done.
  const newStatus = patch.status as FeedbackStatus | undefined
  const oldStatus = existing.status as FeedbackStatus | undefined
  const submitterEmail = existing.submitter_email as string | null
  if (newStatus && newStatus !== oldStatus && NOTIFY_ON.includes(newStatus) && submitterEmail) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from: 'iBuild4you <noreply@ibuild4you.com>',
        // Plus-addressing on Reply-To routes submitter replies back to the
        // inbound webhook, which appends them to feedback/{id}/replies.
        replyTo: feedbackReplyAddress(id),
        to: [submitterEmail],
        subject: `Update on your feedback`,
        text: [
          newStatus === 'acknowledged'
            ? `Thanks for the feedback. We've seen it and added it to the list — we'll follow up when there's progress.`
            : `Quick update: your feedback has been marked as done.`,
          '',
          `> ${(existing.body as string).slice(0, 400)}`,
          '',
          `— iBuild4you`,
        ].join('\n'),
      })
    } catch (err) {
      console.error('[feedback] submitter notification failed:', err)
    }
  }

  return NextResponse.json({ id, ...existing, ...patch })
}
