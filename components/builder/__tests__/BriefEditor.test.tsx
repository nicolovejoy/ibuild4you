// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

const mockMutateAsync = vi.fn<(vars: { project_id: string; content: unknown; source?: string }) => Promise<unknown>>(
  async () => ({}),
)
vi.mock('@/lib/query/hooks', () => ({
  useUpdateBrief: () => ({ mutateAsync: mockMutateAsync, isPending: false, error: null }),
}))
vi.mock('../BriefHistory', () => ({ BriefHistory: () => null }))

import { BriefEditor } from '../BriefEditor'
import type { BriefContent } from '@/lib/types'

const contested = { proposed: 'Square', reason: 'switched POS, confirmed in conversation 3' }
const base: BriefContent = {
  problem: 'Customers cannot order online',
  target_users: 'Cafe customers',
  features: [],
  constraints: '',
  additional_context: '',
  decisions: [
    { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
    { topic: 'Stack', decision: 'Next.js', locked: true },
    { topic: 'Auth', decision: 'Google' },
  ],
  open_risks: [],
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const renderEditor = () => render(<BriefEditor projectId="p1" content={base} version={3} />)
const savedDecisions = () => (mockMutateAsync.mock.calls[0] as unknown as [{ content: BriefContent }])[0].content.decisions ?? []

describe('BriefEditor — contested locks (#197 Part A)', () => {
  it('shows the contest and three actions on a contested lock only', () => {
    renderEditor()
    expect(screen.getByText('Contested')).toBeTruthy()
    expect(screen.getByText(/Maker wants: Square — switched POS/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Accept, keep locked' })).toHaveLength(1)
  })

  it('Accept, keep locked saves the proposal with the lock kept and contest cleared', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Accept, keep locked' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()).toEqual([
      { topic: 'Payment', decision: 'Square', locked: true },
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ project_id: 'p1' })
  })

  it('Accept and unlock saves the proposal unlocked, without the lock-loss guard', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Accept and unlock' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()[0]).toEqual({ topic: 'Payment', decision: 'Square' })
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
  })

  it('Dismiss keeps text and lock, clears the contest', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()[0]).toEqual({ topic: 'Payment', decision: 'Stripe only', locked: true })
  })
})

describe('BriefEditor — lock-loss guard (#197 Part B)', () => {
  const enterRaw = () => {
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    fireEvent.click(screen.getByRole('button', { name: /Raw JSON/ }))
    return screen.getByRole('textbox') as HTMLTextAreaElement
  }

  it('asks before a raw save that unlocks or drops a locked topic, then saves on Yes', async () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, {
      target: {
        value: JSON.stringify({ ...base, decisions: [{ topic: 'Payment', decision: 'Stripe only' }, { topic: 'Auth', decision: 'Google' }] }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('This save removes the lock on: Payment, Stack. Continue?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()).toEqual([
      { topic: 'Payment', decision: 'Stripe only' },
      { topic: 'Auth', decision: 'Google' },
    ])
  })

  it('Cancel keeps the draft and saves nothing', () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, { target: { value: JSON.stringify({ ...base, decisions: [] }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
    // The draft is kept exactly as typed (not reformatted), so match either spacing.
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toMatch(/"decisions":\s*\[\]/)
  })

  it('saves straight away when every lock survives (text edits, new decisions)', async () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, {
      target: {
        value: JSON.stringify({
          ...base,
          decisions: [...(base.decisions ?? []).map((d) => ({ ...d, decision: d.decision + '!' })), { topic: 'DB', decision: 'Firestore' }],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
  })
})
