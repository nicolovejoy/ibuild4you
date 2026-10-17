import { describe, it, expect } from 'vitest'
import { openQuestionsMarkdown } from '../open-questions'

describe('openQuestionsMarkdown', () => {
  it('renders the exact markdown', () => {
    expect(
      openQuestionsMarkdown({
        title: 'Tideline',
        makerName: 'Mara',
        questions: ['Which three tide stations matter most?', 'Should the app work offline?'],
      }),
    ).toBe(
      '## Open questions for Mara — Tideline\n\n- Which three tide stations matter most?\n- Should the app work offline?\n',
    )
  })
})
