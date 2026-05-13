import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildGithubIssue, createGithubIssue, parseGithubRepo } from '../github'
import type { Feedback } from '@/lib/types'

function makeFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'fb_1',
    project_id: 'bakery-louise',
    type: 'bug',
    body: 'Footer cart link 404s on iPhone',
    submitter_email: 'jamie@example.com',
    submitter_uid: null,
    page_url: 'https://bakerylouise.com/menu',
    user_agent: 'Mozilla/5.0',
    viewport: '375x812',
    status: 'new',
    internal_notes: null,
    github_issue_url: null,
    created_at: '2026-05-13T18:00:00.000Z',
    updated_at: '2026-05-13T18:00:00.000Z',
    ...overrides,
  } as Feedback
}

describe('parseGithubRepo', () => {
  it('parses owner/name', () => {
    expect(parseGithubRepo('nicolovejoy/ibuild4you')).toEqual({
      owner: 'nicolovejoy',
      repo: 'ibuild4you',
    })
  })

  it('strips a https://github.com/ prefix', () => {
    expect(parseGithubRepo('https://github.com/nicolovejoy/ibuild4you')).toEqual({
      owner: 'nicolovejoy',
      repo: 'ibuild4you',
    })
  })

  it('strips a trailing .git', () => {
    expect(parseGithubRepo('nicolovejoy/ibuild4you.git')).toEqual({
      owner: 'nicolovejoy',
      repo: 'ibuild4you',
    })
  })

  it('rejects malformed input', () => {
    expect(parseGithubRepo('')).toBeNull()
    expect(parseGithubRepo('justaname')).toBeNull()
    expect(parseGithubRepo('a/b/c')).toBeNull()
  })
})

describe('buildGithubIssue', () => {
  it('builds a title from type + truncated body', () => {
    const issue = buildGithubIssue({
      feedback: makeFeedback({ body: 'a'.repeat(200) }),
      projectTitle: "Bakery Louise",
    })
    expect(issue.title.startsWith('[bug] ')).toBe(true)
    expect(issue.title.length).toBeLessThanOrEqual(120)
  })

  it('keeps a short body intact in the title', () => {
    const issue = buildGithubIssue({
      feedback: makeFeedback({ body: 'Footer cart link 404s on iPhone' }),
      projectTitle: 'Bakery Louise',
    })
    expect(issue.title).toBe('[bug] Footer cart link 404s on iPhone')
  })

  it('collapses whitespace and newlines in the title', () => {
    const issue = buildGithubIssue({
      feedback: makeFeedback({ body: 'Multi\n  line\n\n   problem' }),
      projectTitle: 'Bakery Louise',
    })
    expect(issue.title).toBe('[bug] Multi line problem')
  })

  it('includes project, page url, submitter, viewport, ua, and feedback id in the body', () => {
    const fb = makeFeedback()
    const { body } = buildGithubIssue({ feedback: fb, projectTitle: 'Bakery Louise' })
    expect(body).toContain('Bakery Louise')
    expect(body).toContain('bakery-louise')
    expect(body).toContain('https://bakerylouise.com/menu')
    expect(body).toContain('jamie@example.com')
    expect(body).toContain('375x812')
    expect(body).toContain('Mozilla/5.0')
    expect(body).toContain(fb.id)
    expect(body).toContain(fb.body)
  })

  it('shows "anonymous" when no submitter email', () => {
    const { body } = buildGithubIssue({
      feedback: makeFeedback({ submitter_email: null }),
      projectTitle: 'Bakery Louise',
    })
    expect(body).toContain('anonymous')
  })

  it('labels the issue with feedback + type', () => {
    const issue = buildGithubIssue({
      feedback: makeFeedback({ type: 'idea' }),
      projectTitle: 'Bakery Louise',
    })
    expect(issue.labels).toEqual(['feedback', 'idea'])
  })
})

describe('createGithubIssue', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to the right URL with auth + JSON body and returns the html_url', async () => {
    const fetchMock = vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 42,
          html_url: 'https://github.com/nicolovejoy/ibuild4you/issues/42',
        }),
        { status: 201 }
      )
    )

    const result = await createGithubIssue({
      repo: { owner: 'nicolovejoy', repo: 'ibuild4you' },
      token: 'ghp_xxx',
      issue: { title: 't', body: 'b', labels: ['feedback', 'bug'] },
    })

    expect(result).toEqual({
      url: 'https://github.com/nicolovejoy/ibuild4you/issues/42',
      number: 42,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/nicolovejoy/ibuild4you/issues')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ghp_xxx')
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(JSON.parse(init.body as string)).toEqual({
      title: 't',
      body: 'b',
      labels: ['feedback', 'bug'],
    })
  })

  it('throws with the GitHub error message when the API fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    )
    await expect(
      createGithubIssue({
        repo: { owner: 'x', repo: 'y' },
        token: 't',
        issue: { title: 't', body: 'b', labels: [] },
      })
    ).rejects.toThrow(/Not Found/)
  })
})
