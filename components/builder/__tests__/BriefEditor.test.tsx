// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
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
    expect(screen.getAllByRole('button', { name: /^Accept, keep locked/ })).toHaveLength(1)
  })

  it('Accept, keep locked saves the proposal with the lock kept and contest cleared', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /^Accept, keep locked/ }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()).toEqual([
      { topic: 'Payment', decision: 'Square', locked: true },
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ project_id: 'p1' })
    // A resolve is a hand edit, not a restore — no `source` rides along.
    expect(mockMutateAsync.mock.calls[0][0]).not.toHaveProperty('source')
  })

  it('Accept and unlock saves the proposal unlocked, without the lock-loss guard', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /^Accept and unlock/ }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()[0]).toEqual({ topic: 'Payment', decision: 'Square' })
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
  })

  it('Dismiss keeps text and lock, clears the contest and remembers the proposal', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()[0]).toEqual({
      topic: 'Payment',
      decision: 'Stripe only',
      locked: true,
      contest_dismissed: { proposed: 'Square', at: expect.any(String) },
    })
  })

  it('labels each contest button with its topic and the badge from copy (#197 F)', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'Accept, keep locked — Payment' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept and unlock — Payment' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dismiss — Payment' })).toBeTruthy()
    expect(screen.getByText('Contested').getAttribute('title')).toMatch(/maker confirmed/i)
  })

  it('announces a resolve error as an alert', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('nope'))
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't save that/)
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

  it('editing the draft while the guard is up clears it; Save re-checks the new text', async () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, { target: { value: JSON.stringify({ ...base, decisions: [] }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(screen.getByText(/removes the lock on: Payment, Stack/)).toBeTruthy()
    // Fix the draft instead of confirming — the stale guard must go away.
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: JSON.stringify({ ...base, decisions: [{ topic: 'Stack', decision: 'Next.js', locked: true }] }) },
    })
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
    expect(mockMutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(screen.getByText('This save removes the lock on: Payment. Continue?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedDecisions()).toEqual([{ topic: 'Stack', decision: 'Next.js', locked: true }])
  })

  it('switching view while the guard is up clears it', () => {
    renderEditor()
    const ta = enterRaw()
    fireEvent.change(ta, { target: { value: JSON.stringify({ ...base, decisions: [] }) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(screen.getByText(/removes the lock on/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Structured/ }))
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
    expect(mockMutateAsync).not.toHaveBeenCalled()
  })

  it('structured: unlocking Stack trips the guard; Yes saves Stack unlocked (#197 D)', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    const stackRow = screen.getByDisplayValue('Stack').closest('li') as HTMLElement
    // First button in a decision row is its lock toggle.
    fireEvent.click(within(stackRow).getAllByRole('button')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('This save removes the lock on: Stack. Continue?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, save' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    const stack = savedDecisions().find((d) => d.topic === 'Stack')
    expect(stack).toEqual({ topic: 'Stack', decision: 'Next.js' })
  })

  it('structured: editing a contested decision by hand settles the contest (#197 C)', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    fireEvent.change(screen.getByDisplayValue('Stripe only'), { target: { value: 'Square' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(screen.queryByText(/removes the lock on/)).toBeNull()
    expect(savedDecisions()[0]).toEqual({ topic: 'Payment', decision: 'Square', locked: true })
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

describe('BriefEditor — open risk owners (#220)', () => {
  const withRisks = (): BriefContent => ({
    ...base,
    decisions: [],
    open_risks: ['plain', { text: 'q', owner: 'maker' }, { text: 'b', owner: 'builder' }],
  })
  const renderRisks = () => render(<BriefEditor projectId="p1" content={withRisks()} version={3} />)
  const savedRisks = () =>
    (mockMutateAsync.mock.calls[0] as unknown as [{ content: BriefContent }])[0].content.open_risks

  it('read view badges owned risks', () => {
    renderRisks()
    expect(screen.getAllByText('Maker')).toHaveLength(1)
    expect(screen.getAllByText('Builder')).toHaveLength(1)
    for (const t of ['plain', 'q', 'b']) expect(screen.getByText(t)).toBeTruthy()
  })

  it('owner select round-trips to canonical form on save', async () => {
    renderRisks()
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    const selects = screen.getAllByLabelText('Owner') as HTMLSelectElement[]
    expect(selects.map((s) => s.value)).toEqual(['', 'maker', 'builder'])
    fireEvent.change(selects[0], { target: { value: 'maker' } })
    fireEvent.change(selects[1], { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedRisks()).toEqual([{ text: 'plain', owner: 'maker' }, 'q', { text: 'b', owner: 'builder' }])
  })

  it('editing text keeps the owner', async () => {
    renderRisks()
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    fireEvent.change(screen.getByDisplayValue('q'), { target: { value: 'q2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedRisks()).toEqual(['plain', { text: 'q2', owner: 'maker' }, { text: 'b', owner: 'builder' }])
  })

  it('adding a risk creates an unowned string', async () => {
    renderRisks()
    fireEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
    const input = screen.getByPlaceholderText('Add an open risk…')
    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save brief' }))
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledOnce())
    expect(savedRisks()?.[3]).toBe('new')
  })
})
