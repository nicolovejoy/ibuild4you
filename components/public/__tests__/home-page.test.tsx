// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import React from 'react'

const pushMock = vi.fn()
const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}))

// The page's stylesheet goes through Tailwind's PostCSS plugin, which vitest
// does not run; the styles are irrelevant to behaviour.
vi.mock('../hero/home.css', () => ({}))

// Mutable so each test picks the auth state.
let authState: { user: unknown; loading: boolean; isAuthenticated: boolean } = {
  user: null,
  loading: false,
  isAuthenticated: false,
}
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => authState }))

import { HomePage } from '../home-page'
import { publicCopy } from '@/lib/copy-public'

const en = publicCopy.en.home
const scrollIntoView = vi.fn()

beforeEach(() => {
  authState = { user: null, loading: false, isAuthenticated: false }
  pushMock.mockReset()
  replaceMock.mockReset()
  scrollIntoView.mockReset()
  // jsdom implements neither of these.
  Element.prototype.scrollIntoView = scrollIntoView
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// The scroll helper scrolls the #interest section, then focuses its first input
// once the scroll has settled.
function expectScrolledToInterestForm() {
  expect(scrollIntoView).toHaveBeenCalledTimes(1)
  const target = scrollIntoView.mock.contexts[0] as HTMLElement
  expect(target.id).toBe('interest')
  act(() => {
    vi.advanceTimersByTime(1000)
  })
  const firstInput = target.querySelector('input')
  expect(firstInput).not.toBeNull()
  expect(document.activeElement).toBe(firstInput)
}

describe('HomePage', () => {
  it('"Tell us your idea" scrolls to the interest form and focuses its first input', () => {
    render(<HomePage locale="en" />)
    // The section heading shares the text, so go through the button role.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.cta) }))
    expectScrolledToInterestForm()
  })

  it('the demo composer does the same', () => {
    render(<HomePage locale="en" />)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.composerPlaceholder) }))
    expectScrolledToInterestForm()
  })

  it('the phone fold button toggles aria-expanded and shows the conversation', () => {
    render(<HomePage locale="en" />)
    const fold = screen.getByRole('button', { name: en.showConversation })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    // The desktop chat is always in the DOM; opening the fold adds a second.
    const before = screen.getAllByText(en.composerPlaceholder).length
    fireEvent.click(fold)
    const open = screen.getByRole('button', { name: en.hideConversation })
    expect(open.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText(en.composerPlaceholder).length).toBe(before + 1)
  })

  it('the French page contains none of the English home strings', () => {
    // Every English string under `home` (and the interest form) whose French
    // twin differs. Functions are called with sample arguments.
    const differing: string[] = []
    const walk = (a: unknown, b: unknown) => {
      if (typeof a === 'function' && typeof b === 'function') {
        const fa = (a as (...x: unknown[]) => string)(4, 8, 'Jo')
        const fb = (b as (...x: unknown[]) => string)(4, 8, 'Jo')
        if (fa !== fb) differing.push(fa)
      } else if (typeof a === 'string' && typeof b === 'string') {
        if (a !== b) differing.push(a)
      } else if (Array.isArray(a) && Array.isArray(b)) {
        a.forEach((x, i) => walk(x, b[i]))
      } else if (a && b && typeof a === 'object' && typeof b === 'object') {
        for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
      }
    }
    walk(publicCopy.en.home, publicCopy.fr.home)
    walk(publicCopy.en.landing, publicCopy.fr.landing)
    expect(differing.length).toBeGreaterThan(20)

    const { container } = render(<HomePage locale="fr" />)
    // Open the phone fold so both copies of the conversation are in the DOM.
    fireEvent.click(screen.getByRole('button', { name: publicCopy.fr.home.showConversation }))
    const page = container.textContent ?? ''
    // The page does render French text (guards against an empty render).
    expect(page).toContain(publicCopy.fr.home.headline)
    for (const s of differing) expect(page).not.toContain(s)
    expect(container.querySelector('[data-home]')?.getAttribute('lang')).toBe('fr')
  })

  it('redirects a signed-in visitor to the dashboard and renders nothing', () => {
    authState = { user: { uid: 'u1' }, loading: false, isAuthenticated: true }
    const { container } = render(<HomePage locale="en" />)
    expect(pushMock).toHaveBeenCalledWith('/dashboard')
    expect(container.innerHTML).toBe('')
  })
})
