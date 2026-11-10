'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { publicCopy, type Locale } from '@/lib/copy-public'
import { revealedIds } from '@/lib/public/hero-script'
import { usePublicPageLocale } from '@/components/public/lang'
import { HeroChat } from '@/components/public/hero/HeroChat'
import { HeroBrief } from '@/components/public/hero/HeroBrief'
import { HomeShell, CtaButton, scrollToInterest } from '@/components/public/hero/HomeShell'

// The signed-out home page, shared by / (English) and /fr (French). A static
// split view: a headline and one button, then a window showing a made-up
// project's fourth conversation beside its living brief. Signed-in visitors go
// straight to the dashboard.
export function HomePage({ locale }: { locale: Locale }) {
  const t = publicCopy[locale]
  const { user, loading, isAuthenticated } = useAuth()
  const router = useRouter()
  usePublicPageLocale(locale, locale === 'en' ? '/fr' : '/')

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
    <HomeShell locale={locale}>
      <Demo locale={locale} />
    </HomeShell>
  )
}

function Headline({ locale }: { locale: Locale }) {
  const h = publicCopy[locale].home
  return (
    <div className="mx-auto max-w-3xl space-y-5 text-center">
      <h1 className="text-3xl leading-tight sm:text-4xl lg:text-5xl">{h.headline}</h1>
      <p className="text-lg leading-relaxed text-(--h-muted)">{h.subline}</p>
      <CtaButton locale={locale} />
    </div>
  )
}

// A browser-window frame (three dots, then the content).
function Window({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`hero-window overflow-hidden bg-(--h-panel) ${className ?? ''}`}>
      <div className="hero-dots items-center gap-1.5 border-b border-(--h-line) bg-(--h-surface) px-3 py-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-(--h-line)" />
        <span className="h-2.5 w-2.5 rounded-full bg-(--h-line)" />
        <span className="h-2.5 w-2.5 rounded-full bg-(--h-line)" />
      </div>
      {children}
    </div>
  )
}

// Everything visible, no playback. Desktop: chat left, brief right.
// Phone: brief first, the conversation folded under it.
function Demo({ locale }: { locale: Locale }) {
  const h = publicCopy[locale].home
  const script = h.script.later
  const all = revealedIds(script, script.turns.length)
  const [open, setOpen] = useState(false)
  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
      <Headline locale={locale} />
      <p className="mx-auto mt-10 mb-3 max-w-3xl text-center text-sm text-(--h-caption)">{h.demoCaptionLater}</p>
      <Window>
        {/* Desktop */}
        <div className="hidden md:grid md:grid-cols-2 md:divide-x md:divide-(--h-line)">
          <HeroChat script={script} locale={locale} shown={script.turns.length} onComposerClick={scrollToInterest} />
          <HeroBrief script={script} locale={locale} revealed={all} className="bg-(--h-surface)" />
        </div>
        {/* Phone */}
        <div className="md:hidden">
          <HeroBrief script={script} locale={locale} revealed={all} className="bg-(--h-surface)" />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="w-full border-t border-(--h-line) bg-(--h-surface) px-4 py-3 text-left text-sm font-medium text-(--h-ink) underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--h-ink)"
          >
            {open ? h.hideConversation : h.showConversation}
          </button>
          {open && (
            <HeroChat
              script={script}
              locale={locale}
              shown={script.turns.length}
              onComposerClick={scrollToInterest}
              className="border-t border-(--h-line)"
            />
          )}
        </div>
      </Window>
    </main>
  )
}
