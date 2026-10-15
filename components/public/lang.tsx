'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { publicCopy, type Locale } from '@/lib/copy-public'
import { useLocale, usePageLocale } from '@/components/locale-provider'

/**
 * A public page's language comes from its URL. While mounted this pins the
 * app-wide locale (header, user menu, <html lang>) to it, and a French page
 * remembers French for the rest of the visit (sign-in, dashboard).
 *
 * An English page seen by a viewer who prefers French (cookie or saved
 * profile — e.g. an old link to "/") moves them to the French page instead.
 * The EN toggle records English first, so choosing English sticks.
 */
export function usePublicPageLocale(locale: Locale, otherLanguageHref: string) {
  usePageLocale(locale)
  const { preferredLocale } = useLocale()
  const router = useRouter()
  useEffect(() => {
    if (locale === 'en' && preferredLocale !== 'en') router.replace(otherLanguageHref)
  }, [locale, preferredLocale, otherLanguageHref, router])
}

/** usePublicPageLocale for server-component pages (About). Renders nothing. */
export function PublicPageLocale({ locale, otherLanguageHref }: { locale: Locale; otherLanguageHref: string }) {
  usePublicPageLocale(locale, otherLanguageHref)
  return null
}

/** "FR" on English public pages, "EN" on French ones. */
export function LangSwitch({
  locale,
  href,
  className,
}: {
  locale: Locale
  /** The same page in the other language; defaults to the other language's home. */
  href?: string
  className?: string
}) {
  const { label, aria } = publicCopy[locale].langSwitch
  const to = href ?? publicCopy[locale].langSwitch.href
  const target = locale === 'en' ? 'fr' : 'en'
  const { setLocale } = useLocale()
  return (
    <a
      href={to}
      hrefLang={target}
      // Record the choice before navigating, so the other page doesn't bounce
      // the viewer back to their old preference.
      onClick={() => setLocale(target)}
      aria-label={aria}
      title={aria}
      className={
        className ??
        'text-xs font-semibold tracking-wider px-2 py-1 rounded-md text-gray-600 hover:text-brand-navy hover:bg-gray-100'
      }
    >
      {label}
    </a>
  )
}
