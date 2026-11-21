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

// What GitHub allows in an owner/name pair, lowercased. The result is pasted
// into a shell line on the Settings tab and a builder can type any github_repo, so
// quotes, spaces, "$" and the like must never get through.
const SAFE_FULL_REPO = /^[a-z0-9-]+\/[a-z0-9._-]+$/

// Normalized "owner/name", or null when the value is empty, a bare name, has
// more than one "/", or holds a character GitHub does not allow. A build status
// key is bound to a full repo, so a bare name cannot mint one. No node imports,
// so the Settings tab can use it too.
export function fullRepo(raw: string | null | undefined): string | null {
  const repo = normalizeGithubRepo(raw)
  return SAFE_FULL_REPO.test(repo) ? repo : null
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
