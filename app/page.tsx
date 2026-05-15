'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Send, CheckCircle } from 'lucide-react'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { StatusMessage } from '@/components/ui/StatusMessage'

export default function HomePage() {
  const { user, loading, isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push('/dashboard')
    }
  }, [loading, isAuthenticated, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  if (user) return null

  return (
    <div className="min-h-screen bg-brand-cream">
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-4 pt-20 pb-16">
        <div className="max-w-2xl text-center space-y-6">
          <ScaffoldIcon className="h-16 w-16 text-brand-navy mx-auto" />
          <h1 className="text-4xl font-bold text-brand-charcoal">iBuild4you</h1>
          <p className="text-lg text-brand-slate leading-relaxed">
            Have an idea for an app or website but not sure where to start? Our AI guides you through
            the details and turns your idea into a clear brief — no technical knowledge
            needed.
          </p>
          <LoadingButton
            variant="primary"
            size="lg"
            icon={ArrowRight}
            onClick={() => router.push('/auth/login')}
          >
            Sign in
          </LoadingButton>
          <p className="text-sm text-brand-slate">
            <Link href="/about" className="underline hover:text-brand-charcoal">
              Learn more about how it works
            </Link>
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-brand-charcoal text-center mb-8">How it works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              step: '1',
              title: 'Tell us your idea',
              desc: 'Chat with our AI assistant about what you want to build. No jargon, just a conversation.',
            },
            {
              step: '2',
              title: 'We build a brief',
              desc: "As you talk, we create a structured brief that captures everything you've described.",
            },
            {
              step: '3',
              title: 'Refine over time',
              desc: 'Come back anytime to add more details. Your brief evolves as your thinking does.',
            },
          ].map((item) => (
            <div key={item.step} className="text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-brand-navy text-white font-bold flex items-center justify-center mx-auto">
                {item.step}
              </div>
              <h3 className="font-semibold text-brand-charcoal">{item.title}</h3>
              <p className="text-sm text-brand-slate">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Interest form */}
      <div className="bg-white border-t border-gray-200 py-16">
        <div className="max-w-lg mx-auto px-4">
          <h2 className="text-2xl font-bold text-brand-charcoal text-center mb-2">
            Interested?
          </h2>
          <p className="text-brand-slate text-center mb-8">
            We&apos;re invite-only right now. Let us know you&apos;re interested and we&apos;ll be
            in touch.
          </p>
          <InterestForm />
        </div>
      </div>
    </div>
  )
}

function InterestForm() {
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
        throw new Error(data.error || 'Failed to submit')
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-8 space-y-3">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
        <p className="text-lg font-medium text-gray-900">Thanks for your interest!</p>
        <p className="text-sm text-gray-600">We&apos;ll be in touch when we have a spot for you.</p>
      </div>
    )
  }

  const inputClasses =
    'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <StatusMessage type="error" message={error} />}

      <div>
        <label htmlFor="interest-name" className="block text-sm font-medium text-gray-700 mb-1">
          Name *
        </label>
        <input
          id="interest-name"
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={inputClasses}
          placeholder="Your name"
        />
      </div>

      <div>
        <label htmlFor="interest-email" className="block text-sm font-medium text-gray-700 mb-1">
          Email *
        </label>
        <input
          id="interest-email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          className={inputClasses}
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="interest-how" className="block text-sm font-medium text-gray-700 mb-1">
          How did you find us?
        </label>
        <input
          id="interest-how"
          type="text"
          value={form.how_found}
          onChange={(e) => setForm((f) => ({ ...f, how_found: e.target.value }))}
          className={inputClasses}
          placeholder="Friend, social media, search..."
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="interest-try"
          type="checkbox"
          checked={form.want_to_try}
          onChange={(e) => setForm((f) => ({ ...f, want_to_try: e.target.checked }))}
          className="h-4 w-4 text-brand-navy focus:ring-brand-navy border-gray-300 rounded"
        />
        <label htmlFor="interest-try" className="text-sm text-gray-700">
          I have a project idea I&apos;d like to try this with
        </label>
      </div>

      <div>
        <label htmlFor="interest-what" className="block text-sm font-medium text-gray-700 mb-1">
          Tell us briefly what you&apos;d want to build
        </label>
        <textarea
          id="interest-what"
          value={form.what_for}
          onChange={(e) => setForm((f) => ({ ...f, what_for: e.target.value }))}
          className={inputClasses}
          rows={3}
          placeholder="An app that..., A website for..."
        />
      </div>

      <LoadingButton
        type="submit"
        loading={submitting}
        loadingText="Submitting..."
        fullWidth
        variant="primary"
        icon={Send}
      >
        Express interest
      </LoadingButton>
    </form>
  )
}
