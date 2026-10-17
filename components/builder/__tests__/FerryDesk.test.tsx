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
    expect(screen.queryByText('details body')).toBeNull()
    expect(screen.getByText('brief · history · regenerate · attachments')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Details/ }))
    expect(screen.getByText('details body')).toBeTruthy()
    expect(screen.queryByText('brief · history · regenerate · attachments')).toBeNull()
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
})
