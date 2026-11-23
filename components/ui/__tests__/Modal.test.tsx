// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React, { useState } from 'react'
import { Modal } from '../Modal'

afterEach(cleanup)

// #287: the shared modal is a real dialog: labelled, closable by name and by
// Escape, and it takes focus in and gives it back.

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Hello">
        body
      </Modal>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a modal dialog named by its title', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Delete this brief?">
        body
      </Modal>
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete this brief?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Delete this brief?')
  })

  it('uses the label prop as the name when there is no title', () => {
    render(
      <Modal isOpen onClose={() => {}} label="menu.pdf">
        body
      </Modal>
    )
    expect(screen.getByRole('dialog', { name: 'menu.pdf' })).toBeTruthy()
  })

  it('still has an accessible name when given neither title nor label', () => {
    render(
      <Modal isOpen onClose={() => {}}>
        body
      </Modal>
    )
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeTruthy()
  })

  it('has a close button with an accessible name, with or without a title', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <Modal isOpen onClose={onClose} title="T">
        body
      </Modal>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(
      <Modal isOpen onClose={onClose}>
        body
      </Modal>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('the close button is not hidden until hover', () => {
    render(
      <Modal isOpen onClose={() => {}} title="T">
        body
      </Modal>
    )
    expect(screen.getByRole('button', { name: 'Close' }).className).not.toContain('opacity-0')
  })

  it('the backdrop is half-transparent black, not solid', () => {
    const { container } = render(
      <Modal isOpen onClose={() => {}} title="T">
        body
      </Modal>
    )
    expect(container.innerHTML).toContain('bg-black/50')
    expect(container.innerHTML).not.toContain('bg-opacity')
  })

  it('Escape closes, and a click on the backdrop closes', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal isOpen onClose={onClose} title="T">
        body
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(container.querySelector('.bg-black\\/50') as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('moves focus into the dialog on open and back to the opener on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open it</button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="T">
            <input aria-label="inside" />
          </Modal>
        </>
      )
    }
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('leaves focus alone when a child already took it', () => {
    render(
      <Modal isOpen onClose={() => {}} title="T">
        <input aria-label="inside" autoFocus />
      </Modal>
    )
    expect(document.activeElement).toBe(screen.getByLabelText('inside'))
  })

  it('keeps Tab inside the dialog', () => {
    render(
      <Modal isOpen onClose={() => {}} title="T">
        <button>First</button>
        <button>Last</button>
      </Modal>
    )
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
