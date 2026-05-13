import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import type { FeedbackType } from '@/lib/types'

// Public endpoint: receives submissions from <FeedbackWidget> embedded on
// ibuild4you-hosted client sites. Anti-abuse via honeypot, render-time check,
// and per-IP rate limit. projectId must match an existing `projects.slug` —
// the widget can't write to arbitrary buckets.

const ALLOWED_TYPES: FeedbackType[] = ['bug', 'idea', 'other']
const MAX_BODY_CHARS = 5000
const RATE_LIMIT_PER_HOUR = 5
const ONE_HOUR_MS = 60 * 60 * 1000
// Honeypot timing: anything submitted faster than this is almost certainly a bot.
// 24h ceiling stops replays of stale forms.
const MIN_RENDER_AGE_MS = 2_000
const MAX_RENDER_AGE_MS = 24 * 60 * 60 * 1000

function corsHeaders(): Record<string, string> {
  // Public endpoint — widget can post from any client site we host. Anti-abuse
  // lives in the honeypot + rate limit + slug check, not in the origin allowlist.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, {
    status: init.status ?? 200,
    headers: { ...corsHeaders(), ...(init.headers ?? {}) },
  })
}

export async function POST(request: Request) {
  // Per-IP rate limit before any work.
  const ip = getClientIp(request)
  const limit = checkRateLimit(`feedback:${ip}`, RATE_LIMIT_PER_HOUR, ONE_HOUR_MS)
  if (!limit.ok) {
    return json(
      { error: 'Too many submissions, please try again later' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Honeypot: real users never fill the `website` field.
  if (typeof body.website === 'string' && body.website.length > 0) {
    // Silently 200 so bots don't learn they were caught.
    return json({ ok: true })
  }

  // Render-time check: reject submissions that are suspiciously fast or stale.
  const renderedAt = Number(body._ts)
  if (!Number.isFinite(renderedAt)) {
    return json({ error: 'Invalid submission' }, { status: 400 })
  }
  const age = Date.now() - renderedAt
  if (age < MIN_RENDER_AGE_MS || age > MAX_RENDER_AGE_MS) {
    return json({ error: 'Invalid submission' }, { status: 400 })
  }

  // Required fields.
  const projectIdRaw = body.projectId
  const typeRaw = body.type
  const bodyRaw = body.body
  if (typeof projectIdRaw !== 'string' || !projectIdRaw.trim()) {
    return json({ error: 'projectId is required' }, { status: 400 })
  }
  if (typeof typeRaw !== 'string' || !ALLOWED_TYPES.includes(typeRaw as FeedbackType)) {
    return json({ error: 'type must be bug, idea, or other' }, { status: 400 })
  }
  if (typeof bodyRaw !== 'string' || !bodyRaw.trim()) {
    return json({ error: 'body is required' }, { status: 400 })
  }
  if (bodyRaw.length > MAX_BODY_CHARS) {
    return json({ error: `body too long (max ${MAX_BODY_CHARS} chars)` }, { status: 400 })
  }

  const projectId = projectIdRaw.trim()
  const type = typeRaw as FeedbackType
  const submitterEmail =
    typeof body.submitterEmail === 'string' && body.submitterEmail.trim()
      ? body.submitterEmail.trim().toLowerCase()
      : null
  const pageUrl = typeof body.pageUrl === 'string' ? body.pageUrl.slice(0, 2000) : ''
  const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : ''
  const viewport = typeof body.viewport === 'string' ? body.viewport.slice(0, 50) : ''

  // Optional signed-in user: try the Bearer token, ignore failures.
  let submitterUid: string | null = null
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(token)
      submitterUid = decoded.uid
    } catch {
      // Anonymous submission is allowed; swallow the auth error.
    }
  }

  const db = getAdminDb()

  // Confirm projectId maps to an existing project. Reject otherwise so the
  // widget can't write feedback into a slug we don't own.
  const projectSnap = await db
    .collection('projects')
    .where('slug', '==', projectId)
    .limit(1)
    .get()
  if (projectSnap.empty) {
    return json({ error: 'Unknown project' }, { status: 404 })
  }
  const project = projectSnap.docs[0]
  const projectTitle = (project.data().title as string) || projectId

  const now = new Date().toISOString()
  const docRef = await db.collection('feedback').add({
    project_id: projectId,
    type,
    body: bodyRaw.trim(),
    submitter_email: submitterEmail,
    submitter_uid: submitterUid,
    page_url: pageUrl,
    user_agent: userAgent,
    viewport,
    status: 'new',
    internal_notes: null,
    github_issue_url: null,
    created_at: now,
    updated_at: now,
  })

  // Notify admins — non-blocking; submission succeeds even if email fails.
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'iBuild4you <noreply@ibuild4you.com>',
      to: NOTIFICATION_EMAILS,
      subject: `[${projectTitle}] New ${type}`,
      text: [
        `New ${type} on ${projectTitle} (${projectId})`,
        '',
        bodyRaw.trim(),
        '',
        `From: ${submitterEmail ?? 'anonymous'}`,
        `Page: ${pageUrl || 'n/a'}`,
        `Viewport: ${viewport || 'n/a'}`,
        `UA: ${userAgent || 'n/a'}`,
        '',
        `Feedback ID: ${docRef.id}`,
      ].join('\n'),
    })
  } catch (err) {
    console.error('[feedback] admin notification failed:', err)
  }

  return json({ id: docRef.id }, { status: 201 })
}
