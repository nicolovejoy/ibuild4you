'use client'

import { useEffect, useRef, useState } from 'react'
import {
  buildFeedbackPayload,
  validateFeedbackInput,
  MAX_FEEDBACK_BODY_CHARS,
  type FeedbackContext,
} from '@/lib/feedback/payload'
import type { FeedbackType } from '@/lib/types'

const TYPES: ReadonlyArray<{ value: FeedbackType; label: string }> = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'other', label: 'Other' },
]

interface FeedbackWidgetProps {
  projectId: string
  // Override the endpoint when embedding off-domain. Default targets the
  // ibuild4you instance the widget is hosted on.
  endpoint?: string
  // Optional initial type — defaults to 'bug'.
  defaultType?: FeedbackType
  // Optional className applied to the outer container so the embedder can
  // position it (fixed corner, inline, modal, etc.).
  className?: string
}

type Status = 'idle' | 'submitting' | 'sent' | 'error'

export function FeedbackWidget({
  projectId,
  endpoint = '/api/feedback',
  defaultType = 'bug',
  className = '',
}: FeedbackWidgetProps) {
  const [type, setType] = useState<FeedbackType>(defaultType)
  const [body, setBody] = useState('')
  const [submitterEmail, setSubmitterEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot — must stay empty
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const renderedAtRef = useRef<number>(0)

  // Capture render time once. Server rejects submissions younger than ~2s
  // (bot-fast) or older than 24h (replays).
  useEffect(() => {
    renderedAtRef.current = Date.now()
  }, [])

  const reset = () => {
    setBody('')
    setSubmitterEmail('')
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validation = validateFeedbackInput({ projectId, type, body, submitterEmail })
    if (!validation.ok) {
      setError(validation.message)
      return
    }

    const ctx: FeedbackContext = {
      pageUrl: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      viewport:
        typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
      renderedAt: renderedAtRef.current || Date.now(),
    }
    const payload = {
      ...buildFeedbackPayload({ projectId, type, body, submitterEmail }, ctx),
      // Honeypot — comes from state so a bot filling the field gets caught.
      website,
    }

    setStatus('submitting')
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setStatus('sent')
      reset()
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (status === 'sent') {
    return (
      <div
        className={`max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}
        role="status"
      >
        <p className="text-sm text-brand-charcoal">Thanks — got it.</p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-2 text-xs text-brand-navy hover:underline"
        >
          Send another
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`max-w-sm space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      aria-label="Send feedback"
    >
      <div className="flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            aria-pressed={type === t.value}
            className={`flex-1 rounded border px-2 py-1 text-xs transition-colors ${
              type === t.value
                ? 'border-brand-navy bg-brand-navy text-white'
                : 'border-gray-200 text-brand-charcoal hover:border-brand-navy'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="sr-only">Feedback</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What's up?"
          rows={4}
          maxLength={MAX_FEEDBACK_BODY_CHARS}
          className="w-full resize-y rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
        />
      </label>

      <label className="block">
        <span className="sr-only">Email (optional)</span>
        <input
          type="email"
          value={submitterEmail}
          onChange={(e) => setSubmitterEmail(e.target.value)}
          placeholder="Email (optional, for follow-up)"
          className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
        />
      </label>

      {/*
        Honeypot — visually hidden, accessibility-hidden. Real users don't
        fill it; bots usually do. Submissions with a non-empty `website` are
        silently 200'd by the server.
      */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '1px',
          height: '1px',
          opacity: 0,
        }}
      />

      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full rounded bg-brand-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy/90 disabled:opacity-50"
      >
        {status === 'submitting' ? 'Sending…' : 'Send feedback'}
      </button>
    </form>
  )
}

export default FeedbackWidget
