import { describe, it, expect } from 'vitest'
import { normalizeRepo, repoMatches, renderBriefMd, renderSessionMd, unfoldedNotes } from './brief-markdown.mjs'

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
      { topic: 'Payment', decision: 'Stripe only', locked: true, decided_at: '2026-02-10T12:00:00Z', decided_in_session: 's2' },
      { topic: 'Hosting', decision: 'Vercel', decided_at: '2026-01-05T12:00:00Z' }, // no session → "added"
      { topic: 'Auth', decision: 'Google + passcode', decided_at: '2026-01-05T12:00:00Z', decided_in_session: 's1', revised_at: '2026-02-10T12:00:00Z', revised_in_session: 's2' }, // #218
      { topic: 'Name', decision: 'Undecided' }, // no provenance
    ],
    open_risks: ['Payment fees'],
  },
}
const reviews = [{ annotations: [{ section: 'Features', comment: 'Add loyalty', created_at: '2026-03-01T00:00:00Z' }] }]

describe('renderBriefMd', () => {
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
        '- **Auth**: Google + passcode _(decided conv 1, 2026-01-05; revised conv 2, 2026-02-10)_\n' +
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

describe('renderBriefMd open risk owners (#220)', () => {
  it('renders plain, maker and builder risks', () => {
    const md = renderBriefMd({
      project: { title: 'T' },
      brief: {
        version: 1,
        content: {
          problem: 'p',
          open_risks: ['Payment fees', { text: 'Which stations?', owner: 'maker' }, { text: 'Hosting', owner: 'builder' }],
        },
      },
      sessions: [],
      reviews: [],
    })
    expect(md).toContain('- Payment fees')
    expect(md).toContain('- (maker) Which stations?')
    expect(md).toContain('- (builder) Hosting')
  })
})

describe('unfoldedNotes', () => {
  it('keeps notes with no folded_at, oldest first', () => {
    const docs = [
      { id: 'b', created_at: '2026-03-02T00:00:00Z', folded_at: null },
      { id: 'x', created_at: '2026-03-01T12:00:00Z', folded_at: '2026-03-03T00:00:00Z' },
      { id: 'a', created_at: '2026-03-01T00:00:00Z' },
    ]
    expect(unfoldedNotes(docs).map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('renderBriefMd notes, shipped, queued, contested', () => {
  const note = {
    id: 'NOTEID123',
    session_id: 's2',
    created_at: '2026-03-05T20:00:00Z',
    folded_at: null,
    text: '  Sam wants pickup windows.  ',
    decisions: [{ topic: 'Pickup', decision: '15-minute windows' }],
    risks_added: ['Parking', { text: 'Opening hours', owner: 'maker' }],
    risks_resolved: ['Payment fees', { text: 'Menu size', resolution: 'Twelve items, no more' }],
    lock_reversals: [{ topic: 'Payment', proposed: 'Add cash', reason: 'confirmed Mar 5' }],
    thumbs_down: [{ excerpt: 'SECRET EXCERPT', reason: 'SECRET REASON' }],
  }

  it('omits the notes section when notes is not passed', () => {
    expect(renderBriefMd({ project, brief, sessions, reviews })).not.toContain('## New since')
  })

  it('says so when there are no new notes', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [] })
    expect(md).toContain('## New since the brief was last curated\n\nNo new notes since the brief was last curated.')
  })

  it('renders a note with every part, and never thumbs-down or the id', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [note] })
    expect(md).toContain('These notes are not in the brief above yet. Where a note and the brief disagree, the note is newer.')
    expect(md).toContain('### 2026-03-05, conversation 2\n\nSam wants pickup windows.')
    expect(md).toContain('Decisions:\n- Pickup: 15-minute windows')
    expect(md).toContain('New open risks:\n- Parking\n- (maker) Opening hours')
    expect(md).toContain('Risks settled:\n- Payment fees\n- Menu size → Twelve items, no more')
    expect(md).toContain(
      'Maker asked to reverse a locked decision (on the brief as contested):\n- Payment: wants "Add cash" (confirmed Mar 5)'
    )
    expect(md).not.toContain('SECRET')
    expect(md).not.toContain('NOTEID123')
  })

  it('renders an old or partial note without crashing', () => {
    const old = { id: 'o', session_id: null, created_at: '2026-03-05T20:00:00Z', text: 'Short.', decisions: [] }
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [old] })
    expect(md).toContain('### 2026-03-05\n\nShort.')
    expect(md).not.toContain('conversation undefined')
    expect(md).not.toContain('Risks settled:')
  })

  it('shows the day alone for a note from an archived conversation', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews, notes: [{ ...note, session_id: 'gone' }] })
    expect(md).toContain('### 2026-03-05\n')
  })

  it('leaves out the notes section when there is no brief', () => {
    const md = renderBriefMd({ project, brief: null, sessions: [], reviews: [], notes: [] })
    expect(md).not.toContain('## New since')
  })

  it('renders shipped newest first, skips malformed batches, and renders queued', () => {
    const b = {
      ...brief,
      content: {
        ...brief.content,
        shipped: [
          { date: '2026-02-01', items: ['Menu page'] },
          { date: '2026-03-01', items: ['Ordering', 'Receipts'] },
          { date: '2026-03-02' },
          'junk',
        ],
        queued: ['Loyalty card'],
      },
    }
    const md = renderBriefMd({ project, brief: b, sessions, reviews })
    expect(md).toContain('## Shipped\n\n### 2026-03-01\n- Ordering\n- Receipts\n\n### 2026-02-01\n- Menu page')
    expect(md).not.toContain('### 2026-03-02')
    expect(md).toContain('## Queued\n\n- Loyalty card')
  })

  it('omits shipped and queued when empty', () => {
    const md = renderBriefMd({ project, brief, sessions, reviews })
    expect(md).not.toContain('## Shipped')
    expect(md).not.toContain('## Queued')
  })

  it('shows a contest on a locked decision only', () => {
    const contested = { proposed: 'Add cash', reason: 'confirmed Mar 5' }
    const b = {
      ...brief,
      content: {
        ...brief.content,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
          { topic: 'Hosting', decision: 'Vercel', contested },
        ],
      },
    }
    const md = renderBriefMd({ project, brief: b, sessions, reviews })
    expect(md).toContain('- **Payment**: Stripe only _(locked)_ _(contested: maker asked for "Add cash"; confirmed Mar 5)_')
    expect(md).toContain('- **Hosting**: Vercel\n')
  })

  it('adds the coverage line from whichever stamps the project has', () => {
    const both = { ...project, notes_through_at: '2026-03-06T01:30:00Z', last_maker_message_at: '2026-03-06T18:05:00Z' }
    expect(renderBriefMd({ project: both, brief, sessions, reviews })).toContain(
      'Notes cover conversations through 2026-03-05 17:30 PT. Maker last wrote 2026-03-06 10:05 PT.'
    )
    const one = { ...project, last_maker_message_at: '2026-03-06T18:05:00Z' }
    const md = renderBriefMd({ project: one, brief, sessions, reviews })
    expect(md).toContain('Maker last wrote 2026-03-06 10:05 PT.')
    expect(md).not.toContain('Notes cover')
  })
})
