'use client'

import { Lock } from 'lucide-react'
import { publicCopy, type Locale } from '@/lib/copy-public'
import { sessionNumberById, decisionProvenanceSuffix } from '@/lib/builder/decision-provenance'
import { HERO_SESSIONS, type HeroScript } from '@/lib/public/hero-script'

// The brief half of the home-page demo. Lines not in `revealed` are hidden in
// place (the panel keeps its final height). Decision provenance and the
// Locked badge use the product's own helper and markup (BriefEditor).
export function HeroBrief({
  script,
  locale,
  revealed,
  className,
}: {
  script: HeroScript
  locale: Locale
  revealed: Set<string>
  className?: string
}) {
  const t = publicCopy[locale].home
  const b = script.brief
  const numbers = sessionNumberById(HERO_SESSIONS)
  const complete = revealed.size > 0

  const lineClass = (id: string) =>
    `rounded px-1 -mx-1 transition-opacity duration-700 motion-reduce:transition-none ${
      revealed.has(id) ? 'opacity-100' : 'opacity-0'
    }`

  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 hero-label border-b border-(--h-line) text-[11px] uppercase text-(--h-muted) font-semibold">
        <span className="shrink-0">{t.briefLabel}</span>
        <span
          className={`hero-meta shrink-0 text-(--h-faint) normal-case tracking-normal font-normal transition-opacity duration-700 ${
            complete ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t.briefVersion(b.versionBefore, b.versionAfter)}
        </span>
      </div>
      <div className="flex-1 p-4 space-y-4 text-sm">
        <Section label={t.summary}>
          <p className={`${lineClass(b.summary.id)} text-(--h-text) leading-relaxed`}>
            {b.summary.text}
          </p>
        </Section>

        <Section label={t.features}>
          <ul className="space-y-1.5">
            {b.features.map((f) => (
              <li key={f.id} className={`${lineClass(f.id)} flex gap-2 text-(--h-text-2)`}>
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-(--h-bullet)"
                  aria-hidden
                />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label={t.decisions}>
          <ul className="space-y-2">
            {b.decisions.map((d) => {
              const suffix = decisionProvenanceSuffix(d, numbers)
              return (
                <li key={d.id} className={lineClass(d.id)}>
                  {d.locked && (
                    <span className="hero-badge inline-flex items-center gap-0.5 mr-1.5 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide align-middle">
                      <Lock className="h-2.5 w-2.5" aria-hidden /> {t.locked}
                    </span>
                  )}
                  <span className="font-semibold text-(--h-ink)">{d.topic}:</span>{' '}
                  <span className="text-(--h-text-2)">{d.decision}</span>
                  {suffix && (
                    <span className="hero-meta text-xs text-(--h-faint)"> · {suffix}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>

        <Section label={t.openQuestions}>
          <ul className="space-y-2">
            {b.risks.map((r) => (
              <li key={r.id} className={`${lineClass(r.id)} text-(--h-text-2)`}>
                <span
                  className={`hero-meta mr-1.5 inline-block rounded-(--h-radius-badge) px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide align-middle ${
                    r.owner === 'maker'
                      ? 'bg-(--h-owner-bg) text-(--h-owner-fg)'
                      : 'bg-(--h-owner2-bg) text-(--h-owner2-fg)'
                  }`}
                >
                  {r.owner === 'maker' ? t.ownerMaker(script.makerName) : t.ownerBuilder}
                </span>
                {r.text}
              </li>
            ))}
          </ul>
        </Section>

        {b.queued.length > 0 && (
          <Section label={t.queued}>
            <ul className="space-y-1">
              {b.queued.map((q) => (
                <li key={q.id} className={`${lineClass(q.id)} text-(--h-caption)`}>
                  {q.text}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="hero-label mb-1.5 text-[11px] font-semibold uppercase text-(--h-muted)">
        {label}
      </h3>
      {children}
    </div>
  )
}
