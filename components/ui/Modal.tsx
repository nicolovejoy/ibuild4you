import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { useMakerCopy } from '@/components/locale-context'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  /** Screen-reader name for a modal with no visible title (for example a file preview). */
  label?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ isOpen, onClose, title, label, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const common = useMakerCopy().common

  // Remember what had focus before the dialog opened. This is done during
  // render, not in an effect: React applies a child's autoFocus while
  // committing, before any effect runs, so by then document.activeElement would
  // be the autofocused input inside the dialog. During the first render that
  // shows the dialog, the children have not been committed yet.
  const openerRef = useRef<HTMLElement | null>(null)
  // dialogRef is still empty on that first render, and filled on later ones.
  if (isOpen && !dialogRef.current && typeof document !== 'undefined') {
    const active = document.activeElement as HTMLElement | null
    openerRef.current = active && active !== document.body ? active : null
  }

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // One modal can open from inside another ("Send this email now?" from
      // the Share and Invite window). Each has its own listener, so only the
      // top one, the last dialog in the document, acts on the key.
      const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (open.length > 1 && open[open.length - 1] !== dialogRef.current) return
      if (e.key === 'Escape') {
        // In a browser React removes this modal as soon as this listener
        // returns, so a modal under it would then find itself on top and close
        // too on the same key press. Stop the event here.
        e.stopImmediatePropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      // Keep Tab and Shift+Tab inside the dialog, including when focus has
      // fallen out of it (the focused element was removed or disabled).
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = items[0] ?? dialog
      const last = items[items.length - 1] ?? dialog
      const active = document.activeElement
      if (!active || !dialog.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  // Focus goes into the dialog when it opens and back to the opener when it
  // closes or unmounts. Keyed on isOpen only: onClose is usually a new function
  // every render and must not re-run this.
  useEffect(() => {
    if (!isOpen) {
      openerRef.current = null
      return
    }
    const opener = openerRef.current
    const dialog = dialogRef.current
    // A child with autoFocus has already taken focus; leave it there.
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
    return () => {
      if (opener && opener.isConnected) opener.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-4xl',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label || common.dialogFallbackLabel}
        tabIndex={-1}
        className={`relative bg-white rounded-lg p-6 w-full mx-auto ${sizeClasses[size]} max-h-[90vh] overflow-y-auto shadow-xl focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center mb-4 ${title ? 'justify-between' : 'justify-end'}`}>
          {title && (
            <h3 id={titleId} className="text-lg font-semibold">
              {title}
            </h3>
          )}
          <IconButton
            icon={X}
            onClick={onClose}
            size="sm"
            ariaLabel={common.closeDialog}
            className="focus-visible:ring-2 focus-visible:ring-brand-navy"
          />
        </div>
        {children}
      </div>
    </div>
  )
}
