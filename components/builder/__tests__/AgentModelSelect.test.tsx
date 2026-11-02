// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { AgentModelSelect } from '../AgentModelSelect'

afterEach(cleanup)

// #189: the Setup tab's per-brief model dropdown.
describe('AgentModelSelect', () => {
  it('lists Default then the three models, in order, with their values', () => {
    render(<AgentModelSelect value="" onChange={() => {}} />)
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.textContent)).toEqual(['Default', 'Sonnet 4.6', 'Sonnet 5.5', 'Opus 5.5'])
    expect(options.map((o) => o.value)).toEqual(['', 'claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  })

  it('selects Default when the value is blank', () => {
    render(<AgentModelSelect value="" onChange={() => {}} />)
    expect((screen.getByLabelText('Agent model') as HTMLSelectElement).value).toBe('')
  })

  it('reports the chosen id, and an empty string for Default', () => {
    const onChange = vi.fn()
    render(<AgentModelSelect value="claude-sonnet-5-5" onChange={onChange} />)
    const select = screen.getByLabelText('Agent model')
    fireEvent.change(select, { target: { value: 'claude-opus-5-5' } })
    expect(onChange).toHaveBeenLastCalledWith('claude-opus-5-5')
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('shows the help text', () => {
    render(<AgentModelSelect value="" onChange={() => {}} />)
    expect(screen.getByText(/A change applies from the next conversation/)).toBeTruthy()
  })
})
