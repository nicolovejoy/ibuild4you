// Link-preview text (share title/description + Open Graph card text) in English
// and French. Server-safe: read by app/layout.tsx, app/fr/layout.tsx, the
// per-brief layout's generateMetadata and the opengraph-image routes.
//
// ⚠️ Previews are public: anyone holding a link sees them, and messaging apps
// cache them. A brief's preview may show its title (unless the builder ticked
// "Don't show the brief title in link previews") — never names or contents.
//
// `fr` is typed as the `en` shape, so a key missing in one language fails type-check.

import { toLocale, type Locale } from '@/lib/locale'

const en = {
  ogLocale: 'en_US',
  siteDescription: 'AI-powered project intake — from idea to a working web app in a few days',
  home: {
    alt: 'iBuild4you — from an idea to a working web app in a few days',
    headline: 'From an idea to a working web app in a few days.',
    sub: 'Talk your idea through with an AI, and we build it — no technical knowledge needed.',
    footer: 'Iterative intake and development',
  },
  brief: {
    alt: 'A brief on iBuild4you',
    label: 'Your brief',
    anonymousTitle: 'A brief on iBuild4you',
    description: 'A conversation on iBuild4you that turns an idea into a clear brief.',
    conversations: (n: number) => `${n} conversation${n === 1 ? '' : 's'} so far`,
  },
}

type PreviewCopy = typeof en

const fr: PreviewCopy = {
  ogLocale: 'fr_FR',
  siteDescription: 'Accueil de projets assisté par IA — d’une idée à une application web en quelques jours',
  home: {
    alt: 'iBuild4you — d’une idée à une application web en quelques jours',
    headline: 'D’une idée à une application web en quelques jours.',
    sub: 'Racontez votre idée à une IA, et nous la réalisons — aucune connaissance technique requise.',
    footer: 'Accueil et développement itératifs',
  },
  brief: {
    alt: 'Un brief sur iBuild4you',
    label: 'Votre brief',
    anonymousTitle: 'Un brief sur iBuild4you',
    description: 'Une conversation sur iBuild4you qui transforme une idée en un brief clair.',
    conversations: (n: number) => `${n} conversation${n > 1 ? 's' : ''} jusqu’ici`,
  },
}

export const previewCopy: Record<Locale, PreviewCopy> = { en, fr }

const MAX_TITLE = 70

/** Keep a title short enough for the card; cut on a word boundary when possible. */
export function truncateTitle(title: string): string {
  const t = title.trim()
  if (t.length <= MAX_TITLE) return t
  const cut = t.slice(0, MAX_TITLE - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/** Card footer: "3 conversations so far", or the tagline before the first one. */
export function conversationsLine(locale: Locale, sessionCount: number): string {
  const c = previewCopy[locale]
  return sessionCount > 0 ? c.brief.conversations(sessionCount) : c.home.footer
}

/** Share title/description/locale for a brief link. */
export function briefPreviewMeta(brief: { title: string | undefined; language: unknown; hideTitle: boolean }) {
  const locale = toLocale(brief.language)
  const c = previewCopy[locale]
  const showTitle = !brief.hideTitle && !!brief.title?.trim()
  return {
    locale,
    title: showTitle ? truncateTitle(brief.title as string) : c.brief.anonymousTitle,
    description: c.brief.description,
    ogLocale: c.ogLocale,
  }
}
