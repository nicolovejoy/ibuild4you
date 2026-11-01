// Loop read API: formatting helpers for what hosts see instead of raw data.
// Hosts never get the user agent string (it can fingerprint a person), so the
// read endpoint derives a coarse platform from it here. Summaries are a short
// first line of the feedback body, not the whole text.

export type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'other'

export const SUMMARY_MAX = 140

// Order matters: iPhone/iPad UAs also say "Mac OS X", and Android UAs say "Linux".
export function platformFromUserAgent(ua: string | null | undefined): Platform {
  if (!ua) return 'other'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  if (/macintosh|mac os x/i.test(ua)) return 'mac'
  if (/windows/i.test(ua)) return 'windows'
  if (/linux/i.test(ua)) return 'linux'
  return 'other'
}

// Anything shaped like an email address. Deliberately loose: over-redacting a
// summary is harmless, leaking a typed address to a host is not.
const EMAIL_LIKE = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g

// First non-blank line, trimmed, emails replaced with "[email]", then cut to
// SUMMARY_MAX characters (ellipsis included). Redaction runs before the cut so
// an address straddling the limit cannot leave a fragment behind. A non-string
// body (a malformed row) yields ''.
export function summarize(body: unknown): string {
  if (typeof body !== 'string' || !body) return ''
  const first = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return ''
  const redacted = first.replace(EMAIL_LIKE, '[email]')
  if (redacted.length <= SUMMARY_MAX) return redacted
  return redacted.slice(0, SUMMARY_MAX - 1) + '…'
}
