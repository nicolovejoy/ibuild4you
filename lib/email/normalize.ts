// Canonical email normalization for the whole codebase: trim + lowercase.
// Email is our identity key (auth, approved_emails doc ids, Garm subjects,
// cache keys) — normalizing in exactly one place keeps "Sam@X.com ", "sam@x.com",
// and " SAM@X.COM" from ever being treated as three different people.
//
// New code should call this instead of inlining `.trim().toLowerCase()`.
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

// Shape check: one @, a dot in the domain, no whitespace — validated on the
// normalized form. Deliberately loose (no RFC 5322 parsing); its job is to
// stop placeholders and typos like "name@gmail" before they reach
// approved_emails / project_members, where Garm would 400 every grant attempt.
const EMAIL_SHAPE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

export function isValidEmail(email: string | null | undefined): boolean {
  return EMAIL_SHAPE.test(normalizeEmail(email))
}
