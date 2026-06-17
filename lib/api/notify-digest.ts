// Pure builder for the cross-brief notification digest (#65). One email lists
// every brief with maker activity waiting on the builder, instead of the old
// one-email-per-brief-per-burst spam. The cron resolves the per-brief fields,
// passes them here, and sends a single message.

export interface DigestItem {
  title: string
  url: string
  makerName: string
  pendingSince?: string | null
}

export interface Digest {
  subject: string
  text: string
}

// Returns null when there's nothing pending — the cron should send no email.
export function buildDigest(items: DigestItem[]): Digest | null {
  if (items.length === 0) return null

  const n = items.length
  const subject = n === 1 ? `1 brief has new messages` : `${n} briefs have new messages`

  const lines = items.map((it) => {
    const since = it.pendingSince ? ` (since ${it.pendingSince})` : ''
    return [`• "${it.title}" — from ${it.makerName}${since}`, `  ${it.url}`].join('\n')
  })

  const text = [
    n === 1
      ? 'This brief has new messages waiting for you:'
      : 'These briefs have new messages waiting for you:',
    '',
    ...lines,
  ].join('\n')

  return { subject, text }
}
