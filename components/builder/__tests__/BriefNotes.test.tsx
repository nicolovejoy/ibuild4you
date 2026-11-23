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
    risks_resolved: ['Hosting', { text: 'Start over button?', resolution: 'Yes, on the results page' }],
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
    expect(screen.getByText('Resolved: Start over button? → Yes, on the results page')).toBeTruthy()
    expect(screen.getByText('Wants to change locked Stack: Vue (nephew knows it)')).toBeTruthy()
  })

  it('heads an email-only note Email of', () => {
    render(<UnfoldedNotesList notes={[{ ...note, session_id: null, made_from: 'email' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.getByText('Email of Oct 28')).toBeTruthy()
  })

  it('heads a chat and email note Conversation and email of', () => {
    render(<UnfoldedNotesList notes={[{ ...note, made_from: 'both' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.getByText('Conversation and email of Oct 28')).toBeTruthy()
  })

  it('heads an older email-only note by its email sources', () => {
    const older: BriefNote = {
      ...note,
      session_id: null,
      email_sources: [{ from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-10-28T18:00:00.000Z' }],
    }
    render(<UnfoldedNotesList notes={[older]} />)
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.getByText('Email of Oct 28')).toBeTruthy()
  })

  it("lists each 👎 reply with the maker's reason when there is one", () => {
    render(
      <UnfoldedNotesList
        notes={[{ ...note, thumbs_down: [{ excerpt: 'What is your budget?', reason: 'asked twice' }, { excerpt: 'Hmm' }] }]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.getByText('👎 on Sam’s reply “What is your budget?”: asked twice')).toBeTruthy()
    expect(screen.getByText('👎 on Sam’s reply “Hmm”')).toBeTruthy()
  })

  it('says whose emails a note covered, each name once, in order, with their Pacific days', () => {
    render(
      <UnfoldedNotesList
        notes={[
          {
            ...note,
            email_ids: ['a_p1', 'b_p1', 'c_p1', 'd_p1', 'e_p1'],
            email_sources: [
              // 02:00 UTC on Nov 20 is still Nov 19 in Pacific.
              { from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-11-20T02:00:00.000Z' },
              { from_name: 'Nico', from_role: 'builder', received_at: '2026-11-19T17:30:00.000Z' },
              { from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-11-19T20:45:00.000Z' },
              { from_name: 'Nico', from_role: 'builder', received_at: '2026-11-20T17:00:00.000Z' },
              { from_name: 'Nico', from_role: 'builder', received_at: '2026-11-20T18:00:00.000Z' },
            ],
          },
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.getByText('From email: Bill Duris (Nov 19), Nico (Nov 19, Nov 20)')).toBeTruthy()
    expect(screen.queryByText(/too long to read in full/)).toBeNull()
  })

  it('flags an email that was cut', () => {
    render(<UnfoldedNotesList notes={[{ ...note, email_truncated: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.getByText('One email was too long to read in full. Check the original.')).toBeTruthy()
  })

  it('shows neither line on a note without email fields', () => {
    render(<UnfoldedNotesList notes={[note]} />)
    fireEvent.click(screen.getByRole('button', { name: /New since last curation/ }))
    expect(screen.queryByText(/From email/)).toBeNull()
    expect(screen.queryByText(/too long to read in full/)).toBeNull()
  })
})
