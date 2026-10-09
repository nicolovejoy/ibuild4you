import Link from 'next/link'
import { SiteHeader } from '@/components/site-header'
import { publicCopy, type Locale } from '@/lib/copy-public'
import { HtmlLang } from '@/components/public/lang'

// About page, shared by /about (English) and /fr/about (French).
export function AboutPage({ locale }: { locale: Locale }) {
  const a = publicCopy[locale].about
  return (
    <div className="min-h-screen bg-brand-cream" lang={locale}>
      <HtmlLang locale={locale} />
      <SiteHeader locale={locale} langSwitchHref={locale === 'en' ? '/fr/about' : '/about'} />

      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16 space-y-12 sm:space-y-16">
        {/* What is this? */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{a.title}</h2>
          <p className="text-brand-slate leading-relaxed">{a.intro}</p>
          <p className="text-brand-slate leading-relaxed">{a.whatItIs}</p>
        </section>

        {/* Meet the assistant */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{a.whoIsRoanHeading}</h2>
          <p className="text-brand-slate leading-relaxed">{a.whoIsRoan}</p>
        </section>

        {/* The brief */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{a.briefHeading}</h2>
          <p className="text-brand-slate leading-relaxed">{a.briefIntro}</p>
        </section>

        {/* Roles in a brief */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-brand-charcoal">{a.rolesIntroHeading}</h2>
          <p className="text-brand-slate leading-relaxed">{a.rolesIntro}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RoleCard term={a.roles.originator.term} short={a.roles.originator.short} />
            <RoleCard term={a.roles.contributor.term} short={a.roles.contributor.short} />
            <RoleCard term={a.roles.reviewer.term} short={a.roles.reviewer.short} />
          </div>
        </section>

        {/* Payload references */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{a.payloadHeading}</h2>
          <p className="text-brand-slate leading-relaxed">
            {a.payloadIntro} {a.payloadNote}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PayloadLink
              href="/about/start-a-brief"
              title={a.payloadStart.title}
              desc={a.payloadStart.desc}
            />
            <PayloadLink
              href="/about/next-conversation"
              title={a.payloadNext.title}
              desc={a.payloadNext.desc}
            />
          </div>
        </section>

        {/* Privacy note */}
        <section className="space-y-3 border-l-2 border-brand-navy/30 pl-4">
          <h2 className="text-xl font-semibold text-brand-charcoal">{a.privacyIntroHeading}</h2>
          <p className="text-sm text-brand-slate leading-relaxed">{a.privacy}</p>
        </section>

        {/* CTA */}
        <div className="text-center pt-4">
          <Link
            href="/auth/login"
            className="inline-block px-6 py-2.5 bg-brand-navy text-white rounded-md font-medium hover:bg-brand-navy/90 transition-colors"
          >
            {a.cta}
          </Link>
        </div>

        {/* Signature */}
        <div className="text-right pt-2">
          <p className="text-sm italic text-brand-slate">— Nico Lovejoy</p>
          <p className="text-xs text-brand-slate/70 mt-1">{a.voiceNote}</p>
        </div>
      </div>
    </div>
  )
}

function RoleCard({ term, short }: { term: string; short: string }) {
  return (
    <div className="border border-gray-200 bg-white rounded-xl p-4">
      <p className="font-semibold text-brand-charcoal">{term}</p>
      <p className="text-sm text-brand-slate mt-1 leading-relaxed">{short}</p>
    </div>
  )
}

function PayloadLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block border border-gray-200 bg-white rounded-xl p-4 hover:border-brand-navy/40 transition-colors"
    >
      <p className="font-semibold text-brand-charcoal">{title}</p>
      <p className="text-sm text-brand-slate mt-1 leading-relaxed">{desc}</p>
    </Link>
  )
}
