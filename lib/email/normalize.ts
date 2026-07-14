// Canonical email normalization for the whole codebase: trim + lowercase.
// Email is our identity key (auth, approved_emails doc ids, Garm subjects,
// cache keys) — normalizing in exactly one place keeps "Sam@X.com ", "sam@x.com",
// and " SAM@X.COM" from ever being treated as three different people.
//
// New code should call this instead of inlining `.trim().toLowerCase()`.
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}
