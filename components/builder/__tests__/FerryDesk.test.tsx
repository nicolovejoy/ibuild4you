// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { FerryDesk } from '../FerryDesk'
import type { FerryStamps } from '@/lib/builder/ferry-stamps'
import type { BriefContent } from '@/lib/types'
import { copy } from '@/lib/copy'

afterEach(cleanup)

const stamps = (overrides: Partial<FerryStamps> = {}): FerryStamps => ({
  copied: {
    at: '2026-10-17T16:14:00.000Z',
    absolute: 'Oct 17, 9:14 AM',
    relative: '2 hours ago',
    recency: 'newest',
  },
  pasted: { at: null, absolute: '', relative: '', recency: null, version: null },
  maker: {
    at: '2026-10-16T20:00:00.000Z',
    absolute: 'Oct 16, 1:00 PM',
    relative: 'yesterday',
    recency: 'oldest',
    who: 'Sam',
    newerThanPaste: false,
  },
  ...overrides,
})

function renderDesk(props: Partial<React.ComponentProps<typeof FerryDesk>> = {}) {
  const handlers = {
    onPasteChange: vi.fn(),
    onImport: vi.fn(),
    onCopyPrep: vi.fn(),
    onEscapeEmpty: vi.fn(),
  }
  render(
    <FerryDesk
      stamps={stamps()}
      briefVersion={4}
      briefContent={null}
      sessionCount={3}
      pasteValue=""
      pasteError={null}
      importing={false}
      copyingPrep={false}
      prepCopied={false}
      {...handlers}
      {...props}
    >
      <p>details body</p>
    </FerryDesk>
  )
  return handlers
}

describe('FerryDesk', () => {
  it('renders the three stamps with absolute time and "never" when missing', () => {
    renderDesk()
    expect(screen.getByText('Prep copied')).toBeTruthy()
    expect(screen.getByText('Payload pasted')).toBeTruthy()
    expect(screen.getByText('Last maker activity')).toBeTruthy()
    expect(screen.getByText('Oct 17, 9:14 AM')).toBeTruthy()
    expect(screen.getByText('Oct 16, 1:00 PM')).toBeTruthy()
    expect(screen.getByTestId('stamp-pasted').textContent).toContain('never')
    expect(screen.getByText('Brief v4 · session 3')).toBeTruthy()
  })

  it('notes on the maker stamp when it is newer than the paste', () => {
    renderDesk()
    expect(screen.queryByText(/newer than your paste/)).toBeNull()
    cleanup()

    const hot = stamps()
    hot.maker.newerThanPaste = true
    renderDesk({ stamps: hot })
    expect(screen.getByText(/newer than your paste/)).toBeTruthy()
  })

  it('colours each stamp by recency: newest green, middle amber, oldest red, missing grey', () => {
    const s = stamps()
    s.copied.recency = 'middle'
    s.pasted = { ...s.pasted, at: '2026-10-17T17:00:00.000Z', absolute: 'Oct 17, 10:00 AM', recency: 'newest' }
    renderDesk({ stamps: s })
    expect(screen.getByTestId('stamp-pasted').className).toContain('border-l-emerald-500')
    expect(screen.getByTestId('stamp-copied').className).toContain('border-l-amber-500')
    expect(screen.getByTestId('stamp-maker').className).toContain('border-l-red-500')
    // Colour is not the only signal: the dot carries the order in words.
    expect(screen.getByLabelText('Most recent')).toBeTruthy()
    expect(screen.getByLabelText('In between')).toBeTruthy()
    expect(screen.getByLabelText('Oldest')).toBeTruthy()
    cleanup()

    renderDesk() // pasted is missing in the default fixture
    expect(screen.getByTestId('stamp-pasted').className).not.toMatch(/border-l-(emerald|amber|red)/)
  })

  it('Details is collapsed by default, shows the hint, and reveals children on click', () => {
    renderDesk()
    const toggle = screen.getByRole('button', { name: /Details/ })
    // Children stay mounted while collapsed (so an in-progress brief edit
    // survives a collapse); the wrapper is hidden instead.
    const wrapper = screen.getByText('details body').parentElement as HTMLElement
    expect(wrapper.className).toContain('hidden')
    expect(toggle.getAttribute('aria-controls')).toBe(wrapper.id)
    expect(wrapper.id).toBeTruthy()
    expect(screen.getByText('brief · history · write note · attachments')).toBeTruthy()
    fireEvent.click(toggle)
    expect(wrapper.className).not.toContain('hidden')
    expect(screen.queryByText('brief · history · write note · attachments')).toBeNull()
  })

  it('keeps Details children mounted across a collapse', () => {
    function Stateful() {
      const [v, setV] = React.useState('')
      return <input aria-label="draft" value={v} onChange={(e) => setV(e.target.value)} />
    }
    render(
      <FerryDesk
        stamps={stamps()}
        briefVersion={4}
        briefContent={null}
        sessionCount={3}
        pasteValue=""
        onPasteChange={vi.fn()}
        pasteError={null}
        importing={false}
        onImport={vi.fn()}
        copyingPrep={false}
        prepCopied={false}
        onCopyPrep={vi.fn()}
        onEscapeEmpty={vi.fn()}
      >
        <Stateful />
      </FerryDesk>
    )
    const toggle = screen.getByRole('button', { name: /Details/ })
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'half-typed' } })
    fireEvent.click(toggle) // collapse
    fireEvent.click(toggle) // reopen
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('half-typed')
  })

  it('labels the paste box for screen readers', () => {
    renderDesk()
    expect(screen.getByLabelText('Paste the JSON from your prep chat here…').tagName).toBe('TEXTAREA')
  })

  it('omits the session part of the version line while sessions load', () => {
    renderDesk({ sessionCount: undefined })
    expect(screen.getByText('Brief v4')).toBeTruthy()
    expect(screen.queryByText(/session/)).toBeNull()
  })

  it('suffixes the pasted stamp with the version the paste produced', () => {
    renderDesk({
      stamps: stamps({
        pasted: { at: '2026-10-17T16:20:00.000Z', absolute: 'Oct 17, 9:20 AM', relative: '2 hours ago', recency: 'newest', version: 3 },
      }),
    })
    expect(screen.getByTestId('stamp-pasted').textContent).toContain('2 hours ago · v3')
  })

  it('Import is disabled when the box is empty and calls onImport when filled', () => {
    const empty = renderDesk()
    const importBtn = screen.getByRole('button', { name: /Import JSON/ }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)
    fireEvent.click(importBtn)
    expect(empty.onImport).not.toHaveBeenCalled()
    cleanup()

    const filled = renderDesk({ pasteValue: '{"brief":{}}' })
    fireEvent.click(screen.getByRole('button', { name: /Import JSON/ }))
    expect(filled.onImport).toHaveBeenCalledTimes(1)
  })

  it('Copy prep is disabled when copyPrepDisabled is set and enabled otherwise', () => {
    const off = renderDesk({ copyPrepDisabled: true })
    const btn = screen.getByRole('button', { name: /Copy next-convo prep/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(off.onCopyPrep).not.toHaveBeenCalled()
    cleanup()

    const on = renderDesk()
    fireEvent.click(screen.getByRole('button', { name: /Copy next-convo prep/ }))
    expect(on.onCopyPrep).toHaveBeenCalledTimes(1)
  })

  it('renders notices inside the desk, after Import and before the Details toggle', () => {
    renderDesk({ notices: <p>ignored field note</p> })
    const notice = screen.getByText('ignored field note')
    const importBtn = screen.getByRole('button', { name: /Import JSON/ })
    const details = screen.getByRole('button', { name: /Details/ })
    // DOCUMENT_POSITION_FOLLOWING (4): the argument comes after the receiver.
    expect(importBtn.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(notice.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Escape in an empty box calls onEscapeEmpty; in a filled box it blurs and does not', () => {
    const empty = renderDesk({ pasteValue: '   ' })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(empty.onEscapeEmpty).toHaveBeenCalledTimes(1)
    cleanup()

    const filled = renderDesk({ pasteValue: '{"brief":{}}' })
    const box = screen.getByRole('textbox')
    box.focus()
    expect(document.activeElement).toBe(box)
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(filled.onEscapeEmpty).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(box)
  })

  it('shows the brief version as a label at the top of the desk, before the stamps', () => {
    renderDesk()
    const label = screen.getByTestId('brief-version')
    expect(label.textContent).toBe('Brief v4 · session 3')
    const firstStamp = screen.getByTestId('stamp-copied')
    expect(label.compareDocumentPosition(firstStamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  const pasteWithStamp = (v: number) =>
    JSON.stringify({ _payload_type: 'next-convo', _prep_stamp: { brief_version: v, note_ids: [] }, brief: {} })

  it('under the paste box, says the payload matches when its prep version is the live one', () => {
    renderDesk({ pasteValue: pasteWithStamp(4) })
    const line = screen.getByTestId('paste-version')
    expect(line.textContent).toBe('Prepped from v4 · matches the brief')
  })

  it('under the paste box, warns when the payload was prepped from an older version', () => {
    renderDesk({ pasteValue: pasteWithStamp(3) })
    const line = screen.getByTestId('paste-version')
    expect(line.textContent).toBe(
      'Prepped from v3 · the brief is now v4. Import will stop and ask before saving.'
    )
  })

  it('shows no paste version line for an empty box, bad JSON, or a payload without a prep stamp', () => {
    renderDesk()
    expect(screen.queryByTestId('paste-version')).toBeNull()
    cleanup()
    renderDesk({ pasteValue: '{"brief":' })
    expect(screen.queryByTestId('paste-version')).toBeNull()
    cleanup()
    renderDesk({ pasteValue: '{"brief":{}}' })
    expect(screen.queryByTestId('paste-version')).toBeNull()
  })

  it('renders the openQuestions slot', () => {
    renderDesk({ openQuestions: <div data-testid="oq-slot">questions</div> })
    expect(screen.getByTestId('oq-slot')).toBeTruthy()
  })
})

// --- The preview under the paste box ---

const liveBrief = (over: Partial<BriefContent> = {}): BriefContent => ({
  problem: 'p',
  target_users: 't',
  features: ['f1'],
  constraints: 'c',
  additional_context: '',
  decisions: [
    { topic: 'Hosting', decision: 'Vercel' },
    { topic: 'Auth', decision: 'Google', locked: true },
    { topic: 'Billing', decision: 'Stripe' },
  ],
  open_risks: ['Slow imports'],
  ...over,
})

const patchPaste = (patch: Record<string, unknown>) => JSON.stringify({ brief_patch: patch })

describe('FerryDesk paste preview', () => {
  it('shows nothing for an empty box', () => {
    renderDesk({ briefContent: liveBrief(), pasteValue: '' })
    expect(screen.queryByTestId('paste-changes')).toBeNull()
    expect(screen.queryByTestId('paste-unmatched')).toBeNull()
    expect(screen.queryByTestId('paste-locks')).toBeNull()
    expect(screen.queryByTestId('paste-rewrite')).toBeNull()
    expect(screen.queryByTestId('paste-no-brief')).toBeNull()
  })

  it('shows nothing while the JSON does not parse', () => {
    renderDesk({ briefContent: liveBrief(), pasteValue: '{ "brief_patch": ' })
    expect(screen.queryByTestId('paste-changes')).toBeNull()
  })

  it('shows the Changes line with counts for a patch', () => {
    renderDesk({
      briefContent: liveBrief(),
      pasteValue: patchPaste({
        decisions: [
          { topic: 'Hosting', decision: 'Fly' },
          { topic: 'Email', decision: 'Resend' },
        ],
        open_risks: ['New risk'],
        drop: { features: ['f1'] },
      }),
    })
    expect(screen.getByTestId('paste-changes').textContent).toBe(
      'Changes: 1 decision revised, 1 added · 1 risk added · 1 feature dropped'
    )
  })

  it('says none when a patch changes nothing', () => {
    renderDesk({ briefContent: liveBrief(), pasteValue: patchPaste({}) })
    expect(screen.getByTestId('paste-changes').textContent).toBe('Changes: none. The notes still fold.')
  })

  it('names a drop that matches nothing, in warning style, without the already-imported hint', () => {
    renderDesk({ briefContent: liveBrief(), pasteValue: patchPaste({ drop: { open_risks: ['Ghost risk'] } }) })
    const line = screen.getByTestId('paste-unmatched')
    expect(line.textContent).toBe('Will not import: no risk in the brief reads "Ghost risk".')
    expect(line.className).toContain('text-amber-700')
    expect(line.textContent).not.toContain('already imported')
  })

  it('shows the locked line for a patch aimed at a locked topic', () => {
    renderDesk({
      briefContent: liveBrief(),
      pasteValue: patchPaste({ decisions: [{ topic: 'Auth', decision: 'Email only' }] }),
    })
    const line = screen.getByTestId('paste-locks')
    expect(line.textContent).toBe(copy.brief.patchLocksKept(['Auth']))
    expect(line.className).toContain('text-amber-700')
  })

  it('shows the no-brief line for a patch when the project has no brief', () => {
    renderDesk({ briefContent: null, pasteValue: patchPaste({ features: ['x'] }) })
    expect(screen.getByTestId('paste-no-brief').textContent).toBe(copy.brief.patchNoBrief)
    expect(screen.queryByTestId('paste-changes')).toBeNull()
    cleanup()
    // An empty brief counts as no brief.
    renderDesk({
      briefContent: { problem: '', target_users: '', features: [], constraints: '', additional_context: '' },
      pasteValue: patchPaste({ features: ['x'] }),
    })
    expect(screen.getByTestId('paste-no-brief')).toBeTruthy()
  })

  it('names the decisions a whole-brief payload leaves out', () => {
    const next = liveBrief({ decisions: [{ topic: 'Hosting', decision: 'Vercel' }] })
    renderDesk({ briefContent: liveBrief(), pasteValue: JSON.stringify({ brief: next }) })
    expect(screen.getByTestId('paste-rewrite').textContent).toBe(
      'Whole rewrite: removes 2 decisions: "Auth", "Billing"'
    )
  })

  it('shows the rewrite line for a bare legacy brief too', () => {
    const next = liveBrief({ decisions: [] })
    renderDesk({ briefContent: liveBrief(), pasteValue: JSON.stringify(next) })
    expect(screen.getByTestId('paste-rewrite').textContent).toContain('removes 3 decisions')
  })

  it('shows no rewrite line when the whole brief keeps every decision', () => {
    renderDesk({ briefContent: liveBrief(), pasteValue: JSON.stringify({ brief: liveBrief() }) })
    expect(screen.queryByTestId('paste-rewrite')).toBeNull()
  })

  it('shows no rewrite line when there is no live brief', () => {
    renderDesk({ briefContent: null, pasteValue: JSON.stringify({ brief: liveBrief() }) })
    expect(screen.queryByTestId('paste-rewrite')).toBeNull()
  })

  it('does not throw on a whole brief with malformed decisions', () => {
    renderDesk({ briefContent: liveBrief(), pasteValue: JSON.stringify({ brief: { decisions: 'nope' } }) })
    expect(screen.queryByTestId('paste-rewrite')).toBeNull()
  })
})

describe('copy: preview wording', () => {
  const zero = {
    fields_replaced: [],
    decisions_revised: 0,
    decisions_added: 0,
    decisions_dropped: 0,
    features_added: 0,
    features_dropped: 0,
    risks_added: 0,
    risks_changed: 0,
    risks_dropped: 0,
    queued_added: 0,
    queued_dropped: 0,
    shipped_added: 0,
  }
  it('puts the noun on the first non-zero count of each group', () => {
    expect(copy.brief.patchPreview({ ...zero, decisions_revised: 2, decisions_added: 1, decisions_dropped: 1 })).toBe(
      'Changes: 2 decisions revised, 1 added, 1 dropped'
    )
    expect(copy.brief.patchPreview({ ...zero, decisions_added: 1 })).toBe('Changes: 1 decision added')
    expect(copy.brief.patchPreview({ ...zero, decisions_dropped: 2 })).toBe('Changes: 2 decisions dropped')
    expect(copy.brief.patchPreview({ ...zero, risks_added: 1, risks_changed: 1, risks_dropped: 1 })).toBe(
      'Changes: 1 risk added, 1 changed, 1 dropped'
    )
    expect(copy.brief.patchPreview({ ...zero, features_added: 1, features_dropped: 1 })).toBe(
      'Changes: 1 feature added, 1 dropped'
    )
    expect(copy.brief.patchPreview({ ...zero, queued_added: 2 })).toBe('Changes: 2 queued items added')
    expect(copy.brief.patchPreview({ ...zero, queued_added: 1, queued_dropped: 1 })).toBe(
      'Changes: 1 queued item added, 1 dropped'
    )
    expect(copy.brief.patchPreview({ ...zero, shipped_added: 1 })).toBe('Changes: 1 shipped item added')
    expect(copy.brief.patchPreview({ ...zero, shipped_added: 2 })).toBe('Changes: 2 shipped items added')
    expect(copy.brief.patchPreview({ ...zero, fields_replaced: ['constraints', 'problem'] })).toBe(
      'Changes: constraints, problem replaced'
    )
  })
  it('joins groups with a middle dot and says none when all are zero', () => {
    expect(copy.brief.patchPreview({ ...zero, decisions_revised: 2, decisions_added: 1, risks_dropped: 1, features_added: 1 })).toBe(
      'Changes: 2 decisions revised, 1 added · 1 risk dropped · 1 feature added'
    )
    expect(copy.brief.patchPreview(zero)).toBe('Changes: none. The notes still fold.')
  })
  it('patchDropUnmatched keeps the import wording with preview false and drops the hint with true', () => {
    const u = { decisions: [], features: [], open_risks: ['R'], queued: [] }
    expect(copy.brief.patchDropUnmatched(u, false)).toContain('Not imported: no risk in the brief reads "R".')
    expect(copy.brief.patchDropUnmatched(u, false)).toContain('If this payload was already imported')
    expect(copy.brief.patchDropUnmatched(u, true)).toBe('Will not import: no risk in the brief reads "R".')
  })
  it('wholeRewriteRemoves lists the topics', () => {
    expect(copy.brief.wholeRewriteRemoves(['A', 'B', 'C'])).toBe('Whole rewrite: removes 3 decisions: "A", "B", "C"')
    expect(copy.brief.wholeRewriteRemoves(['A'])).toBe('Whole rewrite: removes 1 decision: "A"')
  })
})
