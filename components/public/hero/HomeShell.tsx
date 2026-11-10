'use client'

import Link from 'next/link'
import { ArrowDown } from 'lucide-react'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { LangSwitch } from '@/components/public/lang'
import { InterestForm } from '@/components/public/interest-form'
import { publicCopy, type Locale } from '@/lib/copy-public'
import './home.css'

export const INTEREST_ANCHOR = 'interest'

// Scroll to the interest form. Smooth unless the visitor prefers reduced motion.
export function scrollToInterest() {
  const el = document.getElementById(INTEREST_ANCHOR)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  const input = el.querySelector<HTMLInputElement>('input')
  // Focus after the scroll settles, without scrolling again.
  setTimeout(() => input?.focus({ preventScroll: true }), reduce ? 0 : 600)
}

// Everything around the demo: the slim header with Sign in demoted to a corner
// link, and the interest form at the bottom, which the "Tell us your idea"
// button and the demo's composer both lead to. The root carries `data-home`,
// which scopes the --h-* tokens in home.css to this page.
export function HomeShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = publicCopy[locale]
  const h = t.home
  return (
    <div className="min-h-screen" data-home lang={locale}>
      <div className="hero-header">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link
            href={locale === 'en' ? '/' : '/fr'}
            className="flex items-center gap-2 rounded text-(--h-wordmark) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink)"
          >
            <ScaffoldIcon className="h-7 w-7 text-(--h-mark)" />
            <span className="text-lg font-bold [font-family:var(--h-font-head)]">iBuild4you</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm">
            <Link
              href={t.aboutHref}
              className="rounded px-2 py-1 text-(--h-muted) hover:text-(--h-ink) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink)"
            >
              {h.about}
            </Link>
            <Link
              href="/auth/login"
              className="rounded px-2 py-1 text-(--h-muted) hover:text-(--h-ink) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink)"
            >
              {h.signIn}
            </Link>
            <LangSwitch
              locale={locale}
              className="rounded-md px-2 py-1 text-xs font-semibold tracking-wider text-(--h-muted) hover:text-(--h-ink) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink)"
            />
          </nav>
        </header>
      </div>

      <main>
        {children}

        <section id={INTEREST_ANCHOR} className="scroll-mt-6 border-t border-(--h-line) bg-(--h-surface) py-16">
          <div className="mx-auto max-w-lg px-4">
            <h2 className="mb-2 text-center text-2xl">{h.cta}</h2>
            <p className="mb-8 text-center text-(--h-muted)">{h.ctaHint}</p>
            <InterestForm locale={locale} />
          </div>
        </section>
      </main>
    </div>
  )
}

export function CtaButton({ locale, className }: { locale: Locale; className?: string }) {
  const h = publicCopy[locale].home
  return (
    <button
      type="button"
      onClick={scrollToInterest}
      className={`hero-btn inline-flex items-center gap-2 px-6 py-3 text-base font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-(--h-ink) focus-visible:ring-offset-2 ${className ?? ''}`}
    >
      {h.cta}
      <ArrowDown className="h-4 w-4" aria-hidden />
    </button>
  )
}
