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

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  // Focus goes into the dialog when it opens and back to whatever opened it
  // when it closes or unmounts. Keyed on isOpen only: onClose is usually a new
  // function every render and must not re-run this.
  useEffect(() => {
    if (!isOpen) return
    const opener = document.activeElement as HTMLElement | null
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

  // Keep Tab and Shift+Tab inside the dialog.
  const handleTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
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
        onKeyDown={handleTab}
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
