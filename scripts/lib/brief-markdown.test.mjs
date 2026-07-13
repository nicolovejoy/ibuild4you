import { describe, it, expect } from 'vitest'
import { normalizeRepo, repoMatches, renderBriefMd, renderSessionMd } from './brief-markdown.mjs'

// =============================================================================
// SHARED BRIEF/TRANSCRIPT MARKDOWN RENDERERS (#133 — extracted from export-brief)
// =============================================================================

describe('normalizeRepo', () => {
  it('strips protocol, host, .git and trailing slash, lowercases', () => {
    expect(normalizeRepo('https://github.com/Nicolovejoy/Byside.git')).toBe('nicolovejoy/byside')
    expect(normalizeRepo('https://github.com/nicolovejoy/byside/')).toBe('nicolovejoy/byside')
    expect(normalizeRepo('nicolovejoy/byside')).toBe('nicolovejoy/byside')
    expect(normalizeRepo('byside')).toBe('byside')
    expect(normalizeRepo('')).toBe('')
    expect(normalizeRepo(null)).toBe('')
  })
})

describe('repoMatches', () => {
  it('matches owner/name, bare name, and URL forms against a wanted owner/name', () => {
    expect(repoMatches('nicolovejoy/byside', 'nicolovejoy/byside')).toBe(true)
    expect(repoMatches('byside', 'nicolovejoy/byside')).toBe(true) // bare stored matches by name
    expect(repoMatches('https://github.com/nicolovejoy/byside', 'nicolovejoy/byside')).toBe(true)
  })
  it('does not match a different repo, and empty stored never matches', () => {
    expect(repoMatches('nicolovejoy/prntd', 'nicolovejoy/byside')).toBe(false)
    expect(repoMatches('', 'nicolovejoy/byside')).toBe(false)
    expect(repoMatches(null, 'nicolovejoy/byside')).toBe(false)
  })
})

describe('renderBriefMd', () => {
  const project = { id: 'p1', slug: 'sams-cafe', title: "Sam's Cafe", status: 'active', context: 'Runs a cafe.' }
  const sessions = [
    { id: 's1', created_at: '2026-01-01T00:00:00Z' },
    { id: 's2', created_at: '2026-02-01T00:00:00Z' },
  ]
  const brief = {
    version: 3,
    updated_at: '2026-03-04T12:00:00Z',
    content: {
      problem: 'No online ordering',
      target_users: 'Local customers',
      features: ['Online ordering', 'Pickup'],
      constraints: 'Mobile-first',
      additional_context: 'Peak is mornings',
      decisions: [
        { topic: 'Payment', decision: 'Stripe only', locked: true, decided_at: '2026-02-10T00:00:00Z', decided_in_session: 's2' },
        { topic: 'Hosting', decision: 'Vercel', decided_at: '2026-01-05T00:00:00Z' }, // no session → "added"
        { topic: 'Name', decision: 'Undecided' }, // no provenance
      ],
      open_risks: ['Payment fees'],
    },
  }
  const reviews = [{ annotations: [{ section: 'Features', comment: 'Add loyalty', created_at: '2026-03-01T00:00:00Z' }] }]

  it('renders a full brief with provenance suffixes matching the exporter', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews })
    expect(md).toBe(
      `# Brief: Sam's Cafe
` +
        `\n` +
        'Exported from ibuild4you.com prod. Project slug: `sams-cafe`. Status: active.\n' +
        'Conversations: 2. Brief version: 3 (updated 2026-03-04).\n' +
        '\n## Builder-provided context\n\nRuns a cafe.\n' +
        '\n## Problem\n\nNo online ordering\n' +
        '\n## Target users\n\nLocal customers\n' +
        '\n## Features\n\n' +
        '- Online ordering\n' +
        '- Pickup\n' +
        '\n## Constraints\n\nMobile-first\n' +
        '\n## Additional context\n\nPeak is mornings\n' +
        '\n## Decisions\n\n' +
        '- **Payment**: Stripe only _(locked)_ _(decided conv 2, 2026-02-10)_\n' +
        '- **Hosting**: Vercel _(added 2026-01-05)_\n' +
        '- **Name**: Undecided\n' +
        '\n## Open risks\n\n' +
        '- Payment fees\n' +
        '\n## Reviewer annotations\n\n' +
        '- [Features] Add loyalty _(2026-03-01)_\n'
    )
  })

  it('renders a Files & artifacts section, pinned first, links with URLs', () => {
    const files = [
      { filename: 'notes.txt', created_at: '2026-01-02T00:00:00Z' },
      {
        filename: 'Pricing sheet',
        url: 'https://example.com/sheet',
        description: 'Source of truth for tiers',
        pinned: true,
        created_at: '2026-01-03T00:00:00Z',
      },
    ]
    const md = renderBriefMd({ project, brief, sessions, reviews, files })
    expect(md).toContain(
      '\n## Files & artifacts\n\n' +
        '- **Pricing sheet** — Source of truth for tiers — https://example.com/sheet _(pinned, added 2026-01-03)_\n' +
        '- **notes.txt** _(added 2026-01-02)_\n'
    )
  })

  it('omits the Files & artifacts section when files are absent or empty', () => {
    expect(renderBriefMd({ project, brief, sessions, reviews })).not.toContain('## Files & artifacts')
    expect(renderBriefMd({ project, brief, sessions, reviews, files: [] })).not.toContain(
      '## Files & artifacts'
    )
  })

  it('handles no brief yet and empty features/reviews', () => {
    const md = renderBriefMd({
      project: { id: 'p2', slug: 'x', title: 'X' },
      brief: null,
      sessions: [],
      reviews: [],
    })
    expect(md).toContain('Conversations: 0. Brief version: none yet (updated —).')
    expect(md).not.toContain('## Problem')
    expect(md).not.toContain('## Reviewer annotations')
  })
})

describe('renderSessionMd', () => {
  it('renders a transcript with agent label, maker name fallback, and attachments', () => {
    const md = renderSessionMd({
      project: { title: 'X' },
      session: { created_at: '2026-01-01T00:00:00Z', status: 'active', summary: 'Kickoff' },
      n: 1,
      total: 2,
      messages: [
        { role: 'agent', content: 'Hi!', created_at: '2026-01-01T00:00:00Z' },
        { role: 'user', sender_display_name: 'Sam', content: 'Hello', created_at: '2026-01-01T00:01:00Z', file_ids: ['f1', 'f2'] },
      ],
      fileNames: new Map([['f1', 'menu.pdf']]),
    })
    expect(md).toBe(
      '# X — conversation 1 of 2\n' +
        '\n' +
        'Started 2026-01-01. Status: active. Messages: 2.\n' +
        '\nSummary: Kickoff\n' +
        '\n' +
        '## Agent (Sam) — 2026-01-01\n' +
        '\n' +
        'Hi!\n' +
        '\n' +
        '## Sam — 2026-01-01\n' +
        '\n' +
        'Hello\n' +
        '\n' +
        '_Attached: menu.pdf, f2_\n' + // f2 has no name → falls back to id
        ''
    )
  })
})
