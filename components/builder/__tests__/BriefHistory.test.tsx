// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

const mockMutate = vi.fn()
let mockVersions: unknown[] = []
let mockLoading = false

vi.mock('@/lib/query/hooks', () => ({
  useBriefVersions: (_id: string, enabled: boolean) => ({
    data: enabled ? mockVersions : undefined,
    isLoading: enabled && mockLoading,
  }),
  useUpdateBrief: () => ({ mutate: mockMutate, isPending: false }),
}))

import { BriefHistory } from '../BriefHistory'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mockVersions = [
    { version: 3, content: { problem: 'v3' }, updated_at: '2026-10-10T19:12:00.000Z', source: 'regen', archived_at: '2026-10-11T00:00:00.000Z' },
    { version: 2, content: { problem: 'v2' }, updated_at: '2026-10-01T00:00:00.000Z', source: null, archived_at: '2026-10-10T00:00:00.000Z' },
  ]
  mockLoading = false
})

describe('BriefHistory (#194)', () => {
  it('is collapsed by default and lists versions (Pacific time + source) when opened', () => {
    render(<BriefHistory projectId="p1" />)
    expect(screen.queryByText(/regenerated/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    expect(screen.getByText(/v3/)).toBeTruthy()
    expect(screen.getByText(/Oct 10, 2026, 12:12 PM PDT/)).toBeTruthy()
    expect(screen.getByText(/regenerated/)).toBeTruthy()
    expect(screen.getByText(/unknown source/)).toBeTruthy()
  })

  it('shows the empty line when there are no versions', () => {
    mockVersions = []
    render(<BriefHistory projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    expect(screen.getByText(/No earlier versions yet/)).toBeTruthy()
  })

  it('restore is two-step and submits the archived content with source restore', () => {
    render(<BriefHistory projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    expect(mockMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/Restore v3\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, restore' }))
    expect(mockMutate).toHaveBeenCalledWith({ project_id: 'p1', content: { problem: 'v3' }, source: 'restore' })
  })

  it('cancel backs out of the confirm step', () => {
    render(<BriefHistory projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Restore v3\?/)).toBeNull()
    expect(mockMutate).not.toHaveBeenCalled()
  })
})
