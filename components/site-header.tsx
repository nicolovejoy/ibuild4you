'use client'

import Link from 'next/link'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { BuildTimestamp } from '@/components/build-timestamp'
import { UserMenu } from '@/components/user-menu'
import { useCurrentUser } from '@/lib/query/hooks'
import { publicCopy, type Locale } from '@/lib/copy-public'
import { LangSwitch } from '@/components/public/lang'

/**
 * `locale` / `langSwitchHref` are only passed by the translated public pages
 * (About, in both languages); everywhere else the header is English with no
 * language toggle, since the app behind sign-in isn't translated.
 */
export function SiteHeader({
  locale = 'en',
  langSwitchHref,
}: { locale?: Locale; langSwitchHref?: string } = {}) {
  const t = publicCopy[locale]
  const { data: currentUser } = useCurrentUser()
  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false

  const headerBg = isAdmin ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-200'
  const logoColor = isAdmin ? 'text-white' : 'text-brand-navy'
  const titleColor = isAdmin ? 'text-white' : 'text-brand-charcoal'
  const linkColor = isAdmin
    ? 'text-slate-300 hover:text-white hover:bg-slate-800'
    : 'text-gray-600 hover:text-brand-navy hover:bg-gray-100'

  return (
    <header className={`border-b sticky top-0 z-10 ${headerBg}`}>
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link
            href={locale === 'fr' ? '/fr' : '/'}
            className="flex items-center gap-3 group relative"
          >
            <ScaffoldIcon className={`h-7 w-7 ${logoColor}`} />
            <h1 className={`text-xl font-bold ${titleColor}`}>iBuild4you</h1>
            <BuildTimestamp />
          </Link>
          <div className="flex items-center gap-2">
            <Link href={t.aboutHref} className={`text-sm px-2 py-1 rounded-md ${linkColor}`}>
              {t.header.about}
            </Link>
            {langSwitchHref && <LangSwitch locale={locale} href={langSwitchHref} />}
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  )
}
