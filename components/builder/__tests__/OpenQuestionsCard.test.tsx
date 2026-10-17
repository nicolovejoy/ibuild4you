// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { OpenQuestionsCard } from '../OpenQuestionsCard'
import { openQuestionsMarkdown } from '@/lib/builder/open-questions'

afterEach(cleanup)

describe('OpenQuestionsCard', () => {
  it('renders nothing with no questions', () => {
    const { container } = render(<OpenQuestionsCard title="Tideline" makerName="Mara" questions={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('lists the questions with the title and count', () => {
    render(<OpenQuestionsCard title="Tideline" makerName="Mara" questions={['a', 'b']} />)
    expect(screen.getByTestId('open-questions')).toBeTruthy()
    expect(screen.getByRole('heading').textContent).toBe('Open questions for Mara (2)')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('copies the markdown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const args = { title: 'Tideline', makerName: 'Mara', questions: ['a', 'b'] }
    render(<OpenQuestionsCard {...args} />)
    fireEvent.click(screen.getByTestId('open-questions-copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(openQuestionsMarkdown(args)))
    await waitFor(() => expect(screen.getByTestId('open-questions-copy').textContent).toContain('Copied!'))
  })
})
