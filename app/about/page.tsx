import Image from 'next/image'
import Link from 'next/link'
import { copy } from '@/lib/copy'

// Curated glossary order for the About page — new RAAC vocabulary only.
// Legacy keys (maker, builder, agent, conversation, nextConversation) still
// live in `copy.glossary` for in-UI tooltips and are intentionally omitted here.
const ABOUT_GLOSSARY_KEYS = [
  'brief',
  'roan',
  'originator',
  'contributor',
  'reviewer',
  'builderDownstream',
  'session',
  'setup',
  'files',
] as const

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-brand-cream">
      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16 space-y-12 sm:space-y-16">
        {/* Header */}
        <div className="text-center space-y-6">
          <div className="relative mx-auto w-40 h-50 sm:w-48 sm:h-60">
            <Image
              src="/roan/roan-hero.webp"
              alt="Roan"
              fill
              priority
              sizes="(min-width: 640px) 192px, 160px"
              className="object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold text-brand-charcoal">iBuild4you</h1>
        </div>

        {/* What is this? */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.title}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.intro}</p>
          <p className="text-brand-slate leading-relaxed">{copy.about.whatItIs}</p>
        </section>

        {/* Meet Roan */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.whoIsRoanHeading}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.whoIsRoan}</p>
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

        {/* Privacy note */}
        <section className="border-l-2 border-brand-navy/30 pl-4">
          <p className="text-sm text-brand-slate leading-relaxed">{copy.about.privacy}</p>
        </section>

        {/* Glossary */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.glossaryHeading}</h2>
          <dl className="space-y-4">
            {ABOUT_GLOSSARY_KEYS.map((key) => {
              const entry = copy.glossary[key]
              return (
                <div
                  key={key}
                  className="bg-white border border-gray-200 rounded-lg px-4 py-3"
                >
                  <dt className="font-medium text-brand-charcoal">{entry.term}</dt>
                  <dd className="text-sm text-brand-slate mt-0.5">{entry.short}</dd>
                </div>
              )
            })}
          </dl>
        </section>

        {/* CTA */}
        <div className="text-center space-y-3 pt-4">
          <Link
            href="/auth/login"
            className="inline-block px-6 py-2.5 bg-brand-navy text-white rounded-md font-medium hover:bg-brand-navy/90 transition-colors"
          >
            {copy.about.cta}
          </Link>
          <p>
            <Link href="/" className="text-sm text-brand-slate hover:text-brand-charcoal underline">
              Back to home
            </Link>
          </p>
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
