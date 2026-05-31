import Image from 'next/image'
import Link from 'next/link'
import { copy } from '@/lib/copy'
import { SiteHeader } from '@/components/site-header'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-brand-cream">
      <SiteHeader />

      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16 space-y-12 sm:space-y-16">
        {/* What is this? */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.title}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.intro}</p>
          <p className="text-brand-slate leading-relaxed">{copy.about.whatItIs}</p>
        </section>

        {/* Meet Roan */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:gap-6">
            <div className="space-y-3 flex-1">
              <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.whoIsRoanHeading}</h2>
              <p className="text-brand-slate leading-relaxed">{copy.about.whoIsRoan}</p>
            </div>
            <div className="relative w-40 h-50 sm:w-40 sm:h-50 mx-auto sm:mx-0 shrink-0 mt-4 sm:mt-0">
              <Image
                src="/roan/roan-hero.webp"
                alt="Roan"
                fill
                priority
                sizes="(min-width: 640px) 160px, 160px"
                className="object-contain"
              />
            </div>
          </div>
        </section>

        {/* The brief */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.briefHeading}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.briefIntro}</p>
        </section>

        {/* Roles in a brief */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.rolesIntroHeading}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.rolesIntro}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RoleCard term={copy.glossary.originator.term} short={copy.glossary.originator.short} />
            <RoleCard term={copy.glossary.contributor.term} short={copy.glossary.contributor.short} />
            <RoleCard term={copy.glossary.reviewer.term} short={copy.glossary.reviewer.short} />
          </div>
        </section>

        {/* Payload references */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">For builders: payload reference</h2>
          <p className="text-brand-slate leading-relaxed">
            Briefs can be set up and updated with JSON. These pages have the copy-pastable
            payloads, annotated field by field.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PayloadLink
              href="/about/start-a-brief"
              title="Starting a brief"
              desc="The payload that creates a new project and its first session."
            />
            <PayloadLink
              href="/about/next-conversation"
              title="Starting the next conversation"
              desc="The payload that updates a brief and steers the maker's next session."
            />
          </div>
        </section>

        {/* Privacy note */}
        <section className="space-y-3 border-l-2 border-brand-navy/30 pl-4">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.privacyIntroHeading}</h2>
          <p className="text-sm text-brand-slate leading-relaxed">{copy.about.privacy}</p>
        </section>

        {/* CTA */}
        <div className="text-center pt-4">
          <Link
            href="/auth/login"
            className="inline-block px-6 py-2.5 bg-brand-navy text-white rounded-md font-medium hover:bg-brand-navy/90 transition-colors"
          >
            {copy.about.cta}
          </Link>
        </div>

        {/* Signature */}
        <div className="text-right pt-2">
          <p className="text-sm italic text-brand-slate">— Nico Lovejoy</p>
          <p className="text-xs text-brand-slate/70 mt-1">{copy.about.voiceNote}</p>
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
