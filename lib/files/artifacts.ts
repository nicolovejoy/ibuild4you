import type { ProjectFile } from '@/lib/types'

// Pure helpers for artifacts (#83 Phase A). Artifacts are just files with a
// few extra optional fields (source, url, description, pinned). Keep validation
// and pin-cap logic here so the routes stay thin and the rules are tested once.

// Soft cap on pinned artifacts per project. The point of pinning is scarcity —
// an unbounded pin list is just the file list again, so a 6th pin is refused.
export const ARTIFACT_PIN_CAP = 5

export const ARTIFACT_NAME_MAX = 120
export const ARTIFACT_DESCRIPTION_MAX = 280

export type LinkInput = { url?: string; filename?: string; description?: string }
export type LinkValue = { url: string; filename: string; description?: string }
export type LinkResult = { ok: true; value: LinkValue } | { ok: false; error: string }

// Validate + normalize a linked-artifact payload. url must be http(s); the
// display name defaults to the url if not given.
export function validateLinkInput(raw: LinkInput): LinkResult {
  const url = (raw.url || '').trim()
  if (!url) return { ok: false, error: 'A link URL is required' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Enter a full URL, e.g. https://example.com' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Links must start with http:// or https://' }
  }

  const filename = ((raw.filename || '').trim() || url).slice(0, ARTIFACT_NAME_MAX)

  const descRaw = (raw.description || '').trim()
  if (descRaw.length > ARTIFACT_DESCRIPTION_MAX) {
    return { ok: false, error: `Description must be ${ARTIFACT_DESCRIPTION_MAX} characters or fewer` }
  }
  const description = descRaw || undefined

  return { ok: true, value: { url, filename, description } }
}

// Normalize a description edit (PATCH). Empty string clears it → null.
export function normalizeDescription(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'description must be a string' }
  const trimmed = raw.trim()
  if (trimmed.length > ARTIFACT_DESCRIPTION_MAX) {
    return { ok: false, error: `Description must be ${ARTIFACT_DESCRIPTION_MAX} characters or fewer` }
  }
  return { ok: true, value: trimmed || null }
}

export function countPinned(files: Pick<ProjectFile, 'pinned'>[]): number {
  return files.filter((f) => f.pinned).length
}

// Is there room to pin one more? Used before pinning a currently-unpinned file.
export function canPinMore(files: Pick<ProjectFile, 'pinned'>[]): boolean {
  return countPinned(files) < ARTIFACT_PIN_CAP
}

// Split pinned artifacts from the rest, preserving input order within each.
export function partitionPinned(files: ProjectFile[]): { pinned: ProjectFile[]; rest: ProjectFile[] } {
  const pinned: ProjectFile[] = []
  const rest: ProjectFile[] = []
  for (const f of files) (f.pinned ? pinned : rest).push(f)
  return { pinned, rest }
}

export function isLinked(file: Pick<ProjectFile, 'source'>): boolean {
  return file.source === 'linked'
}
