import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { buildGithubIssue, createGithubIssue, parseGithubRepo } from '@/lib/feedback/github'
import { findAppBySlug } from '@/lib/api/apps'
import type { Feedback } from '@/lib/types'

// POST /api/admin/feedback/[id]/to-github — admin-only.
//
// Creates a GitHub issue from the feedback in the app's `github_repo`,
// stores the issue URL on the feedback doc, and returns the updated feedback.
// Idempotent: if `github_issue_url` is already set, returns it without
// hitting GitHub a second time.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'GITHUB_TOKEN is not configured on the server' },
      { status: 500 }
    )
  }

  const db = getAdminDb()
  const ref = db.collection('feedback').doc(id)
  const snap = await ref.get()
  if (!snap.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const feedback = { id, ...(snap.data() as Omit<Feedback, 'id'>) } as Feedback

  // Idempotent: don't double-post.
  if (feedback.github_issue_url) {
    return NextResponse.json(feedback)
  }

  // feedback.project_id holds an app slug (canonical for new rows; older rows
  // may hold a legacy slug, which findAppBySlug also resolves).
  const app = await findAppBySlug(db, feedback.project_id)
  if (!app) {
    return NextResponse.json({ error: 'Unknown app' }, { status: 404 })
  }

  if (!app.github_repo) {
    return NextResponse.json({ error: 'App has no github_repo set' }, { status: 400 })
  }
  const repo = parseGithubRepo(app.github_repo)
  if (!repo) {
    return NextResponse.json(
      { error: `Invalid github_repo: ${app.github_repo}` },
      { status: 400 }
    )
  }

  const issuePayload = buildGithubIssue({
    feedback,
    projectTitle: app.name || feedback.project_id,
  })

  let issue: { url: string; number: number }
  try {
    issue = await createGithubIssue({ repo, token, issue: issuePayload })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GitHub API error'
    return NextResponse.json({ error: `GitHub: ${message}` }, { status: 502 })
  }

  const updated_at = new Date().toISOString()
  await ref.update({ github_issue_url: issue.url, updated_at })

  return NextResponse.json({ ...feedback, github_issue_url: issue.url, updated_at })
}
