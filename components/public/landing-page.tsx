'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Send, CheckCircle } from 'lucide-react'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { publicCopy, type Locale } from '@/lib/copy-public'
import { LangSwitch, HtmlLang } from '@/components/public/lang'

// Public landing page, shared by / (English) and /fr (French).
export function LandingPage({ locale }: { locale: Locale }) {
  const t = publicCopy[locale]
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
        <div className="animate-pulse text-brand-slate">{t.loading}</div>
      </div>
    )
  }

  if (user) return null

  return (
    <div className="min-h-screen bg-brand-cream relative" lang={locale}>
      <HtmlLang locale={locale} />
      <div className="absolute top-4 right-4">
        <LangSwitch locale={locale} />
      </div>
      {/* Hero */}
      <div className="flex flex-col items-center justify-center px-4 pt-20 pb-16">
        <div className="max-w-2xl text-center space-y-6">
          <ScaffoldIcon className="h-16 w-16 text-brand-navy mx-auto" />
          <h1 className="text-4xl font-bold text-brand-charcoal">iBuild4you</h1>
          <p className="text-lg text-brand-slate leading-relaxed">{t.landing.tagline}</p>
          <LoadingButton
            variant="primary"
            size="lg"
            icon={ArrowRight}
            onClick={() => router.push('/auth/login')}
          >
            {t.landing.signIn}
          </LoadingButton>
          <p className="text-sm text-brand-slate">
            <Link href={t.aboutHref} className="underline hover:text-brand-charcoal">
              {t.landing.learnMore}
            </Link>
          </p>
        </div>
      </div>

      {/* How it works */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-brand-charcoal text-center mb-8">
          {t.landing.howItWorks}
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          {t.landing.steps.map((item, i) => (
            <div key={i} className="text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-brand-navy text-white font-bold flex items-center justify-center mx-auto">
                {i + 1}
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
            {t.landing.interestTitle}
          </h2>
          <p className="text-brand-slate text-center mb-8">{t.landing.interestSubtitle}</p>
          <InterestForm locale={locale} />
        </div>
      </div>
    </div>
  )
}

function InterestForm({ locale }: { locale: Locale }) {
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
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
        <p className="text-lg font-medium text-gray-900">{t.interestSuccess}</p>
        <p className="text-sm text-gray-600">{t.interestSuccessDetail}</p>
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
        <label htmlFor="interest-email" className="block text-sm font-medium text-gray-700 mb-1">
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
        <label htmlFor="interest-how" className="block text-sm font-medium text-gray-700 mb-1">
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
          className="h-4 w-4 text-brand-navy focus:ring-brand-navy border-gray-300 rounded"
        />
        <label htmlFor="interest-try" className="text-sm text-gray-700">
          {f.wantToTry}
        </label>
      </div>

      <div>
        <label htmlFor="interest-what" className="block text-sm font-medium text-gray-700 mb-1">
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

      <LoadingButton
        type="submit"
        loading={submitting}
        loadingText={f.submitting}
        fullWidth
        variant="primary"
        icon={Send}
      >
        {f.submit}
      </LoadingButton>
    </form>
  )
}
