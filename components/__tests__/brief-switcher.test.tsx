// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

// Phone header: a long brief title must be able to shrink and truncate, never
// run under the icons to its right. Class names are the only handle jsdom has
// (no layout), so these pin the two things that make that work: no shrink-0 on
// the wrapper (the title's ancestors must be allowed to shrink) and
// min-w-0 + truncate on the title.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/locale-context', () => ({
  useMakerCopy: () => ({ chat: { switchBrief: 'Switch brief', yourBriefs: 'Your briefs' } }),
}))
const projectsMock = vi.fn()
vi.mock('@/lib/query/hooks', () => ({ useProjects: () => projectsMock() }))

import { BriefSwitcher } from '../brief-switcher'

const LONG = 'E2E thumbs-down 4h — delete me'

afterEach(() => cleanup())

describe('BriefSwitcher title truncation', () => {
  it('with several briefs, the wrapper may shrink and the title truncates', () => {
    projectsMock.mockReturnValue({
      data: [
        { id: 'p1', title: LONG },
        { id: 'p2', title: 'Other' },
      ],
    })
    const { container } = render(<BriefSwitcher currentId="p1" currentTitle={LONG} loading={false} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('min-w-0')
    expect(wrapper.className).not.toContain('shrink-0')
    const title = screen.getByText(LONG)
    expect(title.className).toContain('truncate')
    expect(title.className).toContain('min-w-0')
  })

  it('with a single brief, the title still truncates', () => {
    projectsMock.mockReturnValue({ data: [{ id: 'p1', title: LONG }] })
    const { container } = render(<BriefSwitcher currentId="p1" currentTitle={LONG} loading={false} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('min-w-0')
    expect(screen.getByText(LONG).className).toContain('truncate')
  })
})
