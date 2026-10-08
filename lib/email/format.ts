// Human-facing timestamps for outbound email. Storage is ISO UTC everywhere;
// a person reading an email is on Nico's clock, so we render in Pacific and
// NAME the zone (PDT/PST) so "5:00 AM" is never ambiguous. Shared convention:
// "UTC at rest, Pacific on display" (CLAUDE.md).

const PACIFIC = 'America/Los_Angeles'

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

// '2026-06-15T12:00:00.000Z' → 'Jun 15, 2026, 5:00 AM PDT'. Empty or
// unparseable input → '' so a caller can simply omit the clause; we never
// want "Invalid Date" in a maker's inbox.
export function formatPacific(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatter.format(d)
}
