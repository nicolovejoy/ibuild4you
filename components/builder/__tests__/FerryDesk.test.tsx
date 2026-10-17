// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { FerryDesk } from '../FerryDesk'
import type { FerryStamps } from '@/lib/builder/ferry-stamps'

afterEach(cleanup)

const stamps = (overrides: Partial<FerryStamps> = {}): FerryStamps => ({
  copied: { at: '2026-10-17T16:14:00.000Z', absolute: 'Oct 17, 9:14 AM', relative: '2 hours ago' },
  pasted: { at: null, absolute: '', relative: '', version: null },
  maker: {
    at: '2026-10-16T20:00:00.000Z',
    absolute: 'Oct 16, 1:00 PM',
    relative: 'yesterday',
    who: 'Sam',
    newerThanPaste: false,
  },
  ...overrides,
})

function renderDesk(props: Partial<React.ComponentProps<typeof FerryDesk>> = {}) {
  const handlers = {
    onPasteChange: vi.fn(),
    onImport: vi.fn(),
    onCopyPrep: vi.fn(),
    onEscapeEmpty: vi.fn(),
  }
  render(
    <FerryDesk
      stamps={stamps()}
      briefVersion={4}
      sessionCount={3}
      pasteValue=""
      pasteError={null}
      importing={false}
      copyingPrep={false}
      prepCopied={false}
      {...handlers}
      {...props}
    >
      <p>details body</p>
    </FerryDesk>
  )
  return handlers
}

describe('FerryDesk', () => {
  it('renders the three stamps with absolute time and "never" when missing', () => {
    renderDesk()
    expect(screen.getByText('Prep copied')).toBeTruthy()
    expect(screen.getByText('Payload pasted')).toBeTruthy()
    expect(screen.getByText('Last maker activity')).toBeTruthy()
    expect(screen.getByText('Oct 17, 9:14 AM')).toBeTruthy()
    expect(screen.getByText('Oct 16, 1:00 PM')).toBeTruthy()
    expect(screen.getByTestId('stamp-pasted').textContent).toContain('never')
    expect(screen.getByText('Brief v4 · session 3')).toBeTruthy()
  })

  it('marks the maker stamp when newerThanPaste is true', () => {
    renderDesk()
    expect(screen.getByTestId('stamp-maker').className).not.toContain('border-brand-navy')
    expect(screen.queryByText(/newer than your paste/)).toBeNull()
    cleanup()

    const hot = stamps()
    hot.maker.newerThanPaste = true
    renderDesk({ stamps: hot })
    expect(screen.getByTestId('stamp-maker').className).toContain('border-brand-navy')
    expect(screen.getByText(/newer than your paste/)).toBeTruthy()
  })

  it('Details is collapsed by default, shows the hint, and reveals children on click', () => {
    renderDesk()
    const toggle = screen.getByRole('button', { name: /Details/ })
    // Children stay mounted while collapsed (so an in-progress brief edit
    // survives a collapse); the wrapper is hidden instead.
    const wrapper = screen.getByText('details body').parentElement as HTMLElement
    expect(wrapper.className).toContain('hidden')
    expect(toggle.getAttribute('aria-controls')).toBe(wrapper.id)
    expect(wrapper.id).toBeTruthy()
    expect(screen.getByText('brief · history · regenerate · attachments')).toBeTruthy()
    fireEvent.click(toggle)
    expect(wrapper.className).not.toContain('hidden')
    expect(screen.queryByText('brief · history · regenerate · attachments')).toBeNull()
  })

  it('keeps Details children mounted across a collapse', () => {
    function Stateful() {
      const [v, setV] = React.useState('')
      return <input aria-label="draft" value={v} onChange={(e) => setV(e.target.value)} />
    }
    render(
      <FerryDesk
        stamps={stamps()}
        briefVersion={4}
        sessionCount={3}
        pasteValue=""
        onPasteChange={vi.fn()}
        pasteError={null}
        importing={false}
        onImport={vi.fn()}
        copyingPrep={false}
        prepCopied={false}
        onCopyPrep={vi.fn()}
        onEscapeEmpty={vi.fn()}
      >
        <Stateful />
      </FerryDesk>
    )
    const toggle = screen.getByRole('button', { name: /Details/ })
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'half-typed' } })
    fireEvent.click(toggle) // collapse
    fireEvent.click(toggle) // reopen
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe('half-typed')
  })

  it('labels the paste box for screen readers', () => {
    renderDesk()
    expect(screen.getByLabelText('Paste the JSON from your prep chat here…').tagName).toBe('TEXTAREA')
  })

  it('omits the session part of the version line while sessions load', () => {
    renderDesk({ sessionCount: undefined })
    expect(screen.getByText('Brief v4')).toBeTruthy()
    expect(screen.queryByText(/session/)).toBeNull()
  })

  it('suffixes the pasted stamp with the version the paste produced', () => {
    renderDesk({
      stamps: stamps({
        pasted: { at: '2026-10-17T16:20:00.000Z', absolute: 'Oct 17, 9:20 AM', relative: '2 hours ago', version: 3 },
      }),
    })
    expect(screen.getByTestId('stamp-pasted').textContent).toContain('2 hours ago · v3')
  })

  it('Import is disabled when the box is empty and calls onImport when filled', () => {
    const empty = renderDesk()
    const importBtn = screen.getByRole('button', { name: /Import JSON/ }) as HTMLButtonElement
    expect(importBtn.disabled).toBe(true)
    fireEvent.click(importBtn)
    expect(empty.onImport).not.toHaveBeenCalled()
    cleanup()

    const filled = renderDesk({ pasteValue: '{"brief":{}}' })
    fireEvent.click(screen.getByRole('button', { name: /Import JSON/ }))
    expect(filled.onImport).toHaveBeenCalledTimes(1)
  })

  it('Copy prep is disabled when copyPrepDisabled is set and enabled otherwise', () => {
    const off = renderDesk({ copyPrepDisabled: true })
    const btn = screen.getByRole('button', { name: /Copy next-convo prep/ }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    expect(off.onCopyPrep).not.toHaveBeenCalled()
    cleanup()

    const on = renderDesk()
    fireEvent.click(screen.getByRole('button', { name: /Copy next-convo prep/ }))
    expect(on.onCopyPrep).toHaveBeenCalledTimes(1)
  })

  it('renders notices inside the desk, after Import and before the Details toggle', () => {
    renderDesk({ notices: <p>ignored field note</p> })
    const notice = screen.getByText('ignored field note')
    const importBtn = screen.getByRole('button', { name: /Import JSON/ })
    const details = screen.getByRole('button', { name: /Details/ })
    // DOCUMENT_POSITION_FOLLOWING (4): the argument comes after the receiver.
    expect(importBtn.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(notice.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Escape in an empty box calls onEscapeEmpty; in a filled box it blurs and does not', () => {
    const empty = renderDesk({ pasteValue: '   ' })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(empty.onEscapeEmpty).toHaveBeenCalledTimes(1)
    cleanup()

    const filled = renderDesk({ pasteValue: '{"brief":{}}' })
    const box = screen.getByRole('textbox')
    box.focus()
    expect(document.activeElement).toBe(box)
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(filled.onEscapeEmpty).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(box)
  })

  it('renders the openQuestions slot', () => {
    renderDesk({ openQuestions: <div data-testid="oq-slot">questions</div> })
    expect(screen.getByTestId('oq-slot')).toBeTruthy()
  })
})
