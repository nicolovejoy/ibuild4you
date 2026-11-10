import type { BriefDecision } from '@/lib/types'
import type { PublicCopy } from '@/lib/copy-public'

// Locale-aware twin of decisionProvenanceSuffix (lib/builder/decision-provenance.ts)
// for the home-page demo. That helper hard-codes English words and en-US dates
// for the builder product, so it can't serve /fr. Same rules: "conv 2 · Jul 11"
// when the session is known, "added Jul 11" when it is not, and a revision
// appended after a comma. The words come from the `home.provenance` copy.

type Provenance = PublicCopy['home']['provenance']

// A calendar day shown to a human is Pacific (see decision-provenance.ts).
const TZ = 'America/Los_Angeles'

const shortDate = (iso: string, dateLocale: string) =>
  new Intl.DateTimeFormat(dateLocale, { month: 'short', day: 'numeric', timeZone: TZ }).format(
    new Date(iso),
  )

export function heroProvenance(
  d: BriefDecision,
  numbers: Map<string, number>,
  words: Provenance,
): string | null {
  const parts: string[] = []
  if (d.decided_at) {
    const n = d.decided_in_session ? numbers.get(d.decided_in_session) : undefined
    const date = shortDate(d.decided_at, words.dateLocale)
    parts.push(n ? words.conv(n, date) : words.added(date))
  }
  if (d.revised_at) {
    const n = d.revised_in_session ? numbers.get(d.revised_in_session) : undefined
    const date = shortDate(d.revised_at, words.dateLocale)
    parts.push(n ? words.revisedConv(n, date) : words.revised(date))
  }
  return parts.length ? parts.join(', ') : null
}
