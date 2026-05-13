import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { buildGithubIssue, createGithubIssue, parseGithubRepo } from '@/lib/feedback/github'
import type { Feedback } from '@/lib/types'

// POST /api/admin/feedback/[id]/to-github — admin-only.
//
// Creates a GitHub issue from the feedback in the project's `github_repo`,
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

  // Look up the project by slug — feedback.project_id stores the slug.
  const projectSnap = await db
    .collection('projects')
    .where('slug', '==', feedback.project_id)
    .limit(1)
    .get()
  if (projectSnap.empty) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const projectDoc = projectSnap.docs[0]
  const project = projectDoc.data() as { title?: string; github_repo?: string }

  if (!project.github_repo) {
    return NextResponse.json(
      { error: 'Project has no github_repo set' },
      { status: 400 }
    )
  }
  const repo = parseGithubRepo(project.github_repo)
  if (!repo) {
    return NextResponse.json(
      { error: `Invalid github_repo: ${project.github_repo}` },
      { status: 400 }
    )
  }

  const issuePayload = buildGithubIssue({
    feedback,
    projectTitle: project.title || feedback.project_id,
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
