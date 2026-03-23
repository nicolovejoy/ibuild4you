import Link from 'next/link'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { copy } from '@/lib/copy'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-brand-cream">
      <div className="max-w-2xl mx-auto px-4 py-16 space-y-12">
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
