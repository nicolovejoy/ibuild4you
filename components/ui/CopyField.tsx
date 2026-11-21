'use client'

import { useEffect, useRef, useState } from 'react'

const button =
  'px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

const fieldClass = 'flex-1 px-2 py-1 text-sm font-mono border border-gray-200 rounded'

// A read-only text field with autofill switched off, so a password manager
// cannot offer to fill it. (Same treatment as ReadKeyPanel: otherwise 1Password
// offers "Sign in" on the shown-once key and accepting it would overwrite it.)
// The button words come from the caller's copy block.
export function CopyField({
  id,
  label,
  value,
  copyLabel,
  copiedLabel,
}: {
  id: string
  label: string
  value: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the "Copied" reset timer when the field goes away.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-500 mb-0.5">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          id={id}
          name={id}
          value={value}
          readOnly
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          onFocus={(e) => e.currentTarget.select()}
          className={fieldClass}
        />
        <button type="button" onClick={onCopy} className={button}>
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
    </div>
  )
}
