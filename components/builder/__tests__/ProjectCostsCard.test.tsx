// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { ProjectCostsCard } from '../ProjectCostsCard'
import type { ProjectUsageResponse } from '@/lib/api/project-usage'

const useProjectUsageMock = vi.fn()
// Mock the whole hooks module: the real one pulls in the Firebase client,
// which throws without an API key. The card only needs useProjectUsage.
vi.mock('@/lib/query/hooks', () => ({
  useProjectUsage: (...args: unknown[]) => useProjectUsageMock(...args),
}))

const data: ProjectUsageResponse = {
  total_calls: 7,
  total_cost: 0.4321,
  by_route: [
    { key: 'chat', calls: 5, cost: 0.3, input: 1, output: 1, cache_read: 0, cache_create: 0 },
    { key: 'brief.generate', calls: 2, cost: 0.1321, input: 1, output: 1, cache_read: 0, cache_create: 0 },
  ],
  by_session: [
    { key: 's1', label: 'Conversation 1', number: 1, session_created_at: '2026-10-01T17:00:00.000Z', calls: 3, cost: 0.2, input: 1, output: 1, cache_read: 0, cache_create: 0, first_call_at: '2026-10-01T17:00:00.000Z', last_call_at: '2026-10-01T17:30:00.000Z' },
    { key: '(none)', label: 'Brief updates & other', number: null, session_created_at: null, calls: 2, cost: 0.1321, input: 1, output: 1, cache_read: 0, cache_create: 0, first_call_at: '2026-10-01T18:00:00.000Z', last_call_at: '2026-10-01T18:00:00.000Z' },
  ],
  truncated: false,
}

afterEach(cleanup)
beforeEach(() => useProjectUsageMock.mockReset())

describe('ProjectCostsCard', () => {
  it('shows the total collapsed and the breakdown when expanded', () => {
    useProjectUsageMock.mockReturnValue({ data, isLoading: false, error: null })
    render(<ProjectCostsCard projectId="p1" />)
    expect(screen.getByText(/~\$0\.43/)).toBeTruthy()
    expect(screen.queryByText('Conversation 1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /api costs/i }))
    expect(screen.getByText('Conversation 1')).toBeTruthy()
    expect(screen.getByText('Brief updates & other')).toBeTruthy()
    expect(screen.getByText('brief.generate')).toBeTruthy()
    // Pacific, zone named: 17:00Z on Oct 1 is 10:00 AM PDT.
    expect(screen.getByText(/Oct 1, 2026, 10:00 AM PDT/)).toBeTruthy()
  })

  it('renders a quiet empty state when there are no calls', () => {
    useProjectUsageMock.mockReturnValue({
      data: { ...data, total_calls: 0, total_cost: 0, by_route: [], by_session: [] },
      isLoading: false,
      error: null,
    })
    render(<ProjectCostsCard projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /api costs/i }))
    expect(screen.getByText(/No API calls yet/)).toBeTruthy()
    expect(screen.queryByText('NaN')).toBeNull()
  })

  it('flags a truncated result', () => {
    useProjectUsageMock.mockReturnValue({ data: { ...data, truncated: true }, isLoading: false, error: null })
    render(<ProjectCostsCard projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /api costs/i }))
    expect(screen.getByText(/first 5,?000 calls/i)).toBeTruthy()
  })
})
