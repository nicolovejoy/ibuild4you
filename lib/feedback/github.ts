import type { Feedback } from '@/lib/types'

// GitHub issue title cap. GitHub's hard limit is 256; we keep ours shorter so
// the type prefix + truncation marker fit cleanly.
const MAX_TITLE_LEN = 120
const TRUNCATE_MARKER = '…'

export interface GithubRepo {
  owner: string
  repo: string
}

export interface IssuePayload {
  title: string
  body: string
  labels: string[]
}

// Accepts "owner/name", "owner/name.git", or a full https://github.com/owner/name URL.
export function parseGithubRepo(input: string): GithubRepo | null {
  if (!input) return null
  let cleaned = input.trim()
  cleaned = cleaned.replace(/^https?:\/\/github\.com\//, '')
  cleaned = cleaned.replace(/\.git$/, '')
  const parts = cleaned.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  const [owner, repo] = parts
  if (!owner || !repo) return null
  return { owner, repo }
}

export function buildGithubIssue({
  feedback,
  projectTitle,
}: {
  feedback: Feedback
  projectTitle: string
}): IssuePayload {
  const collapsed = feedback.body.replace(/\s+/g, ' ').trim()
  const prefix = `[${feedback.type}] `
  const room = MAX_TITLE_LEN - prefix.length
  const title =
    prefix +
    (collapsed.length <= room
      ? collapsed
      : `${collapsed.slice(0, room - TRUNCATE_MARKER.length)}${TRUNCATE_MARKER}`)

  const submitter = feedback.submitter_email || 'anonymous'
  const lines = [
    `> ${feedback.body.replace(/\n/g, '\n> ')}`,
    '',
    '---',
    `**Project:** ${projectTitle} (\`${feedback.project_id}\`)`,
    `**Type:** ${feedback.type}`,
    `**From:** ${submitter}`,
    `**Page:** ${feedback.page_url || 'n/a'}`,
    `**Viewport:** ${feedback.viewport || 'n/a'}`,
    `**User agent:** ${feedback.user_agent || 'n/a'}`,
    `**Submitted:** ${feedback.created_at}`,
    `**Feedback ID:** ${feedback.id}`,
  ]

  return {
    title,
    body: lines.join('\n'),
    labels: ['feedback', feedback.type],
  }
}

export async function createGithubIssue({
  repo,
  token,
  issue,
}: {
  repo: GithubRepo
  token: string
  issue: IssuePayload
}): Promise<{ url: string; number: number }> {
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(issue),
  })

  if (!res.ok) {
    let message = `GitHub API ${res.status}`
    try {
      const data = (await res.json()) as { message?: string }
      if (data.message) message = data.message
    } catch {
      // ignore JSON parse errors — fall back to status code
    }
    throw new Error(message)
  }

  const data = (await res.json()) as { number: number; html_url: string }
  return { url: data.html_url, number: data.number }
}
