import Link from 'next/link'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { copy } from '@/lib/copy'

export default function AboutPage() {
  const glossaryEntries = Object.entries(copy.glossary)

  return (
    <div className="min-h-screen bg-brand-cream">
      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-16 space-y-12 sm:space-y-16">
        {/* Header */}
        <div className="text-center space-y-4">
          <ScaffoldIcon className="h-12 w-12 text-brand-navy mx-auto" />
          <h1 className="text-3xl font-bold text-brand-charcoal">iBuild4you</h1>
        </div>

        {/* What is this? */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.title}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.intro}</p>
          <p className="text-brand-slate leading-relaxed">{copy.about.whatItIs}</p>
        </section>

        {/* How it works */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-brand-charcoal">How it works</h2>
          <div className="space-y-4">
            {copy.landing.steps.map((step, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-brand-navy text-white font-bold flex items-center justify-center shrink-0 text-sm">
                  {i + 1}
                </div>
                <div>
                  <h3 className="font-medium text-brand-charcoal">{step.title}</h3>
                  <p className="text-sm text-brand-slate">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Two roles */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.twoRoles}</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.rolesIntro}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <RoleCard
              role="Maker"
              accent="amber"
              tagline={copy.glossary.maker.short}
              shape="chat"
            />
            <RoleCard
              role="Builder"
              accent="navy"
              tagline={copy.glossary.builder.short}
              shape="console"
            />
          </div>
        </section>

        {/* Glossary */}
        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-brand-charcoal">{copy.about.glossaryHeading}</h2>
          <dl className="space-y-4">
            {glossaryEntries.map(([key, entry]) => (
              <div
                key={key}
                className="bg-white border border-gray-200 rounded-lg px-4 py-3"
              >
                <dt className="font-medium text-brand-charcoal">{entry.term}</dt>
                <dd className="text-sm text-brand-slate mt-0.5">{entry.short}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* What happens next */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-brand-charcoal">What happens next?</h2>
          <p className="text-brand-slate leading-relaxed">{copy.about.whatHappensNext}</p>
          <p className="text-sm text-brand-slate">{copy.about.privacy}</p>
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

// Visual hint at the two app shapes — small CSS-only mocks, not screenshots.
// Maker = single chat surface (phone-shaped). Builder = sidebar + main (desktop-shaped).
function RoleCard({
  role,
  accent,
  tagline,
  shape,
}: {
  role: string
  accent: 'amber' | 'navy'
  tagline: string
  shape: 'chat' | 'console'
}) {
  const accentClasses =
    accent === 'amber'
      ? 'border-amber-300 bg-amber-50/60'
      : 'border-brand-navy/30 bg-stone-50'
  const badgeClasses =
    accent === 'amber' ? 'bg-amber-500 text-white' : 'bg-brand-navy text-white'

  return (
    <div className={`border rounded-xl p-4 ${accentClasses}`}>
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${badgeClasses}`}
        >
          {role}
        </span>
      </div>
      {shape === 'chat' ? <ChatShape /> : <ConsoleShape />}
      <p className="text-sm text-brand-slate mt-3 leading-relaxed">{tagline}</p>
    </div>
  )
}

function ChatShape() {
  return (
    <div className="rounded-md border border-amber-200 bg-white p-2 h-24 flex flex-col gap-1.5">
      <div className="w-1/2 h-2 rounded bg-gray-200" />
      <div className="self-start w-3/4 h-3 rounded-md bg-gray-100" />
      <div className="self-end w-2/3 h-3 rounded-md bg-brand-navy/80" />
      <div className="self-start w-1/2 h-3 rounded-md bg-gray-100" />
      <div className="mt-auto w-full h-3 rounded bg-gray-50 border border-gray-200" />
    </div>
  )
}

function ConsoleShape() {
  return (
    <div className="rounded-md border border-brand-navy/20 bg-white h-24 flex overflow-hidden">
      <div className="w-1/3 bg-slate-800 p-1.5 flex flex-col gap-1">
        <div className="h-2 w-full rounded bg-slate-600" />
        <div className="h-2 w-2/3 rounded bg-slate-700" />
        <div className="h-2 w-3/4 rounded bg-slate-700" />
        <div className="h-2 w-1/2 rounded bg-slate-700" />
      </div>
      <div className="flex-1 p-1.5 flex flex-col gap-1">
        <div className="h-2 w-1/2 rounded bg-gray-200" />
        <div className="h-2 w-full rounded bg-gray-100" />
        <div className="h-2 w-3/4 rounded bg-gray-100" />
        <div className="h-2 w-5/6 rounded bg-gray-100" />
      </div>
    </div>
  )
}
