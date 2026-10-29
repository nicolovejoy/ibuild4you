// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { StalePrepNotice, UnfoldedNotesList } from '../BriefNotes'
import type { BriefNote } from '@/lib/types'

afterEach(cleanup)

// #229: the Brief tab's stale-prep notice and the unfolded-notes list.

describe('StalePrepNotice', () => {
  it('a 409 shows the missed notes and Save anyway resends with force', () => {
    const onSaveAnyway = vi.fn()
    render(
      <StalePrepNotice
        info={{
          error: 'stale_prep',
          // 02:00 UTC on Oct 29 is still Oct 28 in Pacific.
          unlisted_notes: [{ id: 'bbb', created_at: '2026-10-29T02:00:00.000Z' }],
          live_version: 4,
          prep_version: 3,
        }}
        saving={false}
        onSaveAnyway={onSaveAnyway}
      />
    )
    expect(screen.getByText(/This prep is out of date/)).toBeTruthy()
    expect(screen.getByText(/1 note was written after the prep was copied/)).toBeTruthy()
    expect(screen.getByText(/the brief is now v4, the prep was made from v3/)).toBeTruthy()
    expect(screen.getByText('Note from Oct 28')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    expect(onSaveAnyway).toHaveBeenCalledTimes(1)
  })

  it('a version-only 409 lists no notes', () => {
    render(
      <StalePrepNotice
        info={{ error: 'stale_prep', unlisted_notes: [], live_version: 5, prep_version: 3 }}
        saving={false}
        onSaveAnyway={() => {}}
      />
    )
    expect(screen.queryByText(/written after the prep/)).toBeNull()
    expect(screen.queryByText(/Note from/)).toBeNull()
  })
})

describe('UnfoldedNotesList', () => {
  const note: BriefNote = {
    id: 'n1',
    session_id: 's1',
    created_at: '2026-10-28T18:00:00.000Z',
    folded_at: null,
    text: 'Maker wants pickup slots.',
    decisions: [{ topic: 'Payment', decision: 'Square' }],
    risks_added: [{ text: 'Who prints menus?', owner: 'maker' }],
    risks_resolved: ['Hosting'],
    lock_reversals: [{ topic: 'Stack', proposed: 'Vue', reason: 'nephew knows it' }],
  }

  it('is hidden when there are no notes', () => {
    const { container } = render(<UnfoldedNotesList notes={[]} />)
    expect(container.textContent).toBe('')
  })

  it('is collapsed by default and shows each note when opened', () => {
    render(<UnfoldedNotesList notes={[note]} />)
    expect(screen.queryByText(/pickup slots/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /New since last curation \(1\)/ }))
    expect(screen.getByText('Conversation of Oct 28')).toBeTruthy()
    expect(screen.getByText('Maker wants pickup slots.')).toBeTruthy()
    expect(screen.getByText('Decision: Payment: Square')).toBeTruthy()
    expect(screen.getByText('Open risk (maker): Who prints menus?')).toBeTruthy()
    expect(screen.getByText('Resolved: Hosting')).toBeTruthy()
    expect(screen.getByText('Wants to change locked Stack: Vue (nephew knows it)')).toBeTruthy()
  })
})
