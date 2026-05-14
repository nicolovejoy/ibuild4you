import { NextResponse } from 'next/server'
import { Webhook, WebhookVerificationError } from 'svix'
import { getAdminDb } from '@/lib/firebase/admin'
import { buildInboundReply, findFeedbackIdInRecipients } from '@/lib/feedback/inbound'

// =============================================================================
// POST /api/webhooks/resend/inbound — receives Resend's `email.received`
// webhook for replies to submitter notifications. Verifies the Svix
// signature, finds the feedback row via the plus-addressed recipient
// (`feedback+<id>@inbox.ibuild4you.com`), pulls the body, and appends to
// the feedback/{id}/replies subcollection.
//
// Trust model:
//   - Without a valid signature, NOTHING is written. The signature is the
//     only thing standing between this endpoint and forged "submitter said
//     X" replies — keep it strict.
//   - We respond 200 to most "couldn't-route-this" cases so Resend doesn't
//     retry forever. Failures get logged; Resend's own dashboard is the
//     source of truth for undeliverable inbound.
// =============================================================================

// Resend's webhook envelope. We don't trust the shape — every field is
// optional from our side and parsed defensively.
interface ResendWebhookEnvelope {
  type?: string
  data?: {
    email_id?: string
    to?: string[] | string
    from?: string
    subject?: string
    message_id?: string
  }
}

// Default URL template for fetching the full inbound email by id. Resend's
// REST surface is in flux for inbound; if the default 404s, set
// RESEND_INBOUND_FETCH_URL to a template containing `{id}` (e.g.
// `https://api.resend.com/emails/received/{id}`).
const DEFAULT_FETCH_URL_TEMPLATE = 'https://api.resend.com/emails/{id}'

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET
  if (!secret) {
    console.error('[resend-inbound] RESEND_INBOUND_SECRET is not set; refusing all inbound')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  // Svix verification requires the EXACT raw bytes of the request body.
  // Don't .json() first — even a re-serialize will fail the signature.
  const rawBody = await request.text()
  const svixHeaders = {
    'svix-id': request.headers.get('svix-id') ?? '',
    'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
    'svix-signature': request.headers.get('svix-signature') ?? '',
  }

  let payload: ResendWebhookEnvelope
  try {
    const wh = new Webhook(secret)
    payload = wh.verify(rawBody, svixHeaders) as ResendWebhookEnvelope
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    console.error('[resend-inbound] verification error:', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 })
  }

  // Only react to inbound mail. Other event types (delivered, bounced, etc.)
  // are ack'd 200 so Resend doesn't retry. They're not errors — they're
  // just not interesting here.
  if (payload.type !== 'email.received') {
    return NextResponse.json({ ok: true, ignored: payload.type ?? 'unknown' })
  }

  const data = payload.data ?? {}
  const feedbackId = findFeedbackIdInRecipients(data.to)
  if (!feedbackId) {
    console.warn('[resend-inbound] no feedback id in recipients:', data.to)
    return NextResponse.json({ ok: true, ignored: 'no-feedback-id' })
  }

  const db = getAdminDb()
  const feedbackRef = db.collection('feedback').doc(feedbackId)
  const feedbackSnap = await feedbackRef.get()
  if (!feedbackSnap.exists) {
    console.warn('[resend-inbound] feedback doc not found for id:', feedbackId)
    return NextResponse.json({ ok: true, ignored: 'feedback-not-found' })
  }

  const fromEmail = (data.from ?? '').trim().toLowerCase()
  const subject = data.subject ?? ''
  const emailId = data.email_id ?? ''

  // Webhook ships metadata only — fetch the body separately. If retrieval
  // fails, we still record the reply (with a placeholder body) so the admin
  // sees that a reply arrived and can dig in via the Resend dashboard.
  const body = await fetchInboundBody(emailId, { subject })

  const reply = buildInboundReply({ feedbackId, fromEmail, body })

  await feedbackRef.collection('replies').add(reply)

  // Bump the parent feedback's status back to 'new' so the row resurfaces in
  // the admin's default filter, plus refresh updated_at for sort order.
  await feedbackRef.update({
    status: 'new',
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, feedback_id: feedbackId })
}

// Pull the plain-text body of an inbound email from Resend. Returns a
// best-effort string; falls back to a placeholder if retrieval fails so the
// caller can keep going and the reply row still exists.
async function fetchInboundBody(
  emailId: string,
  ctx: { subject: string }
): Promise<string> {
  if (!emailId) {
    return placeholderBody(ctx, 'no email_id in webhook payload')
  }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return placeholderBody(ctx, 'RESEND_API_KEY not set')
  }
  const template =
    process.env.RESEND_INBOUND_FETCH_URL?.trim() || DEFAULT_FETCH_URL_TEMPLATE
  const url = template.replace('{id}', encodeURIComponent(emailId))

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      console.warn(
        `[resend-inbound] body fetch ${res.status} for ${emailId} via ${url}`
      )
      return placeholderBody(ctx, `fetch returned ${res.status}`)
    }
    const json = (await res.json()) as { text?: string; html?: string }
    if (typeof json.text === 'string' && json.text.trim()) return json.text
    if (typeof json.html === 'string' && json.html.trim()) {
      return stripHtml(json.html)
    }
    return placeholderBody(ctx, 'no text or html in response')
  } catch (err) {
    console.warn('[resend-inbound] body fetch threw:', err)
    return placeholderBody(ctx, err instanceof Error ? err.message : 'unknown error')
  }
}

function placeholderBody(ctx: { subject: string }, reason: string): string {
  return `[Reply received — body retrieval failed: ${reason}]\nSubject: ${ctx.subject}`
}

// Crude HTML → text. Inbound replies arrive with quoted history regardless;
// we're not trying to produce a clean digest, just something readable.
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
