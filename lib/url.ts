// URL builders for the app. Centralized so share-link construction lives in one
// place instead of being re-derived inline at every call site.

/**
 * Public share link for a project (the maker-facing conversation URL).
 * Prefers the slug; falls back to the project id. Returns '' when there is no
 * `window` (SSR / non-browser), matching the prior inline guards.
 */
export function getProjectShareLink(slug: string | undefined, idFallback: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/projects/${slug || idFallback}`
}
