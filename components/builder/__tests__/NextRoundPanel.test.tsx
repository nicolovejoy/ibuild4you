// @vitest-environment jsdom
// The Conversations tab's read-only "Next round" panel.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { copy } from '@/lib/copy'
import { NextRoundPanel } from '../NextRoundPanel'
import type { Project, Session } from '@/lib/types'

const t = copy.nextRound

const project = (extra: Partial<Project> = {}) => ({ id: 'p1', title: 'Cafe', ...extra }) as Project
const session = (id: string, welcome?: string) => ({ id, welcome_message: welcome }) as Session

afterEach(cleanup)

describe('NextRoundPanel', () => {
  it('starts folded, with the paste it came from in the heading', () => {
    render(
      <NextRoundPanel
        project={project({
          payload_pasted_at: '2026-11-20T02:00:00.000Z',
          payload_pasted_version: 14,
        })}
        sessions={[]}
        unusedSessionId={null}
      />
    )
    const heading = screen.getByRole('button', { name: new RegExp(t.heading) })
    expect(heading.getAttribute('aria-expanded')).toBe('false')
    // 02:00 UTC on Nov 20 is Nov 19 in Los Angeles.
    expect(heading.textContent).toContain(t.pasted('Nov 19', 14))
    expect(screen.queryByText(t.opening)).toBeNull()
  })

  it('says so when nothing was pasted', () => {
    render(<NextRoundPanel project={project()} sessions={[]} unusedSessionId={null} />)
    expect(screen.getByRole('button', { name: new RegExp(t.heading) }).textContent).toContain(
      t.neverPasted
    )
  })

  it('shows the opening, the mode, its points and the nudge, with nothing to edit', () => {
    const onOpenImport = vi.fn()
    render(
      <NextRoundPanel
        project={project({
          welcome_message: 'Hi Maya, round two.',
          session_mode: 'converge',
          builder_directives: ['Pick a payment flow'],
          seed_questions: ['An old question'],
          nudge_message: 'Come back when you can.',
        })}
        sessions={[session('s1', 'Hi Maya, round one.')]}
        unusedSessionId={null}
        onOpenImport={onOpenImport}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.heading) }))

    expect(screen.getByText('Hi Maya, round two.')).toBeTruthy()
    expect(screen.getByText(t.modes.converge)).toBeTruthy()
    expect(screen.getByText(t.points.converge)).toBeTruthy()
    expect(screen.getByText('Pick a payment flow')).toBeTruthy()
    // Seed questions do not reach the agent in converge mode, so they are not listed.
    expect(screen.queryByText('An old question')).toBeNull()
    expect(screen.getByText('Come back when you can.')).toBeTruthy()

    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t.pasteLink }))
    expect(onOpenImport).toHaveBeenCalled()
  })

  it('says Sam greets when the welcome was already used, and that Sam drafts the nudge', () => {
    render(
      <NextRoundPanel
        project={project({ welcome_message: 'Hi Maya.' })}
        sessions={[session('s1', 'Hi Maya.')]}
        unusedSessionId={null}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.heading) }))
    expect(screen.getByText(t.openingKickoff)).toBeTruthy()
    expect(screen.getByText(t.noPoints)).toBeTruthy()
    expect(screen.getByText(t.nudgeDrafted)).toBeTruthy()
  })
})
