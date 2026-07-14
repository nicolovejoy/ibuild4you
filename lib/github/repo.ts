// Normalize + match github_repo values (#142). Ported from
// scripts/lib/brief-markdown.mjs (normalizeRepo/repoMatches) so the sibling-
// brief lookup can group briefs that belong to the same product regardless of
// how their github_repo was typed. Stored values are messy in prod: one brief
// has "byside", its siblings have "nicolovejoy/byside" — those are one family.

// Normalize to "owner/name" (lowercased). Accepts "owner/name", a bare "name",
// or a full https://github.com/owner/name URL. Mirrors normalizeRepo in the mjs.
export function normalizeGithubRepo(raw: string | null | undefined): string {
  return (raw || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
}

// Do two github_repo values refer to the same repo? Symmetric (unlike the mjs
// repoMatches, which only matched when the *wanted* value was fully qualified):
// exact normalized match, OR — when at least one side is a bare name — a match
// on the name part. Two different owners with the same name (alice/app vs
// bob/app) do NOT match.
export function reposMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeGithubRepo(a)
  const nb = normalizeGithubRepo(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const aBare = !na.includes('/')
  const bBare = !nb.includes('/')
  if (aBare || bBare) {
    return na.split('/').pop() === nb.split('/').pop()
  }
  return false
}
