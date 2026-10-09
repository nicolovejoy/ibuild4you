'use client'

import { useEffect } from 'react'
import { publicCopy, type Locale } from '@/lib/copy-public'

/**
 * The app has one root layout with <html lang="en">. The French public pages
 * also put lang="fr" on their own wrapper (what screen readers and browser
 * translation honour), and this sets the document-level attribute to match
 * while the page is mounted, restoring it on the way out.
 */
export function HtmlLang({ locale }: { locale: Locale }) {
  useEffect(() => {
    const root = document.documentElement
    const previous = root.lang
    root.lang = locale
    return () => {
      root.lang = previous
    }
  }, [locale])
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
  return (
    <a
      href={to}
      hrefLang={target}
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
