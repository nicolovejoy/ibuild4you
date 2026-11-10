'use client'

import { useState } from 'react'
import { Send, Loader2, CheckCircle } from 'lucide-react'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { publicCopy, type Locale } from '@/lib/copy-public'

// The "express interest" form at the bottom of the home page. Posts to
// /api/interest. Styled with the home page's --h-* tokens, so it only looks
// right inside the `data-home` root (see components/public/hero/home.css).
export function InterestForm({ locale }: { locale: Locale }) {
  const t = publicCopy[locale].landing
  const f = t.form
  const [form, setForm] = useState({
    name: '',
    email: '',
    how_found: '',
    want_to_try: false,
    what_for: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || f.failed)
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : f.generic)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-8 space-y-3">
        <CheckCircle className="h-12 w-12 text-(--h-mark) mx-auto" aria-hidden />
        <p className="text-lg font-medium text-(--h-ink)">{t.interestSuccess}</p>
        <p className="text-sm text-(--h-muted)">{t.interestSuccessDetail}</p>
      </div>
    )
  }

  const inputClasses =
    'w-full px-3 py-2 border border-(--h-line-input) bg-(--h-surface) text-(--h-ink) rounded-md shadow-sm placeholder:text-(--h-faint) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-mark) focus-visible:border-(--h-mark)'
  const labelClasses = 'block text-sm font-medium text-(--h-text-2) mb-1'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <StatusMessage type="error" message={error} />}

      <div>
        <label htmlFor="interest-name" className={labelClasses}>
          {f.name}
        </label>
        <input
          id="interest-name"
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={inputClasses}
          placeholder={f.namePlaceholder}
        />
      </div>

      <div>
        <label htmlFor="interest-email" className={labelClasses}>
          {f.email}
        </label>
        <input
          id="interest-email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className={inputClasses}
          placeholder={f.emailPlaceholder}
        />
      </div>

      <div>
        <label htmlFor="interest-how" className={labelClasses}>
          {f.howFound}
        </label>
        <input
          id="interest-how"
          type="text"
          value={form.how_found}
          onChange={(e) => setForm((f) => ({ ...f, how_found: e.target.value }))}
          className={inputClasses}
          placeholder={f.howFoundPlaceholder}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="interest-try"
          type="checkbox"
          checked={form.want_to_try}
          onChange={(e) => setForm((f) => ({ ...f, want_to_try: e.target.checked }))}
          className="h-4 w-4 rounded border-(--h-line-input) accent-(--h-mark) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-mark) focus-visible:ring-offset-2"
        />
        <label htmlFor="interest-try" className="text-sm text-(--h-text-2)">
          {f.wantToTry}
        </label>
      </div>

      <div>
        <label htmlFor="interest-what" className={labelClasses}>
          {f.whatFor}
        </label>
        <textarea
          id="interest-what"
          value={form.what_for}
          onChange={(e) => setForm((f) => ({ ...f, what_for: e.target.value }))}
          className={inputClasses}
          rows={3}
          placeholder={f.whatForPlaceholder}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="hero-btn flex w-full items-center justify-center gap-2 px-6 py-3 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink) focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Send className="h-4 w-4" aria-hidden />
        )}
        {submitting ? f.submitting : f.submit}
      </button>
    </form>
  )
}
