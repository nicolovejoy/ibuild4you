// #83 Phase B — feed pinned artifacts (files + links) into the agent system
// prompt so Sam knows what load-bearing material exists on the brief. Names +
// descriptions ONLY, never bytes: the actual file contents still ride
// message.file_ids attachments. Mirror of prototype-context.ts — pure helpers
// here (unit-testable selection/formatting); lib/api/artifact-context.ts does
// the Firestore query.

export interface RawArtifactRow {
  filename?: string
  source?: string
  description?: string
  url?: string
  pinned?: boolean
  status?: string
}

export interface ArtifactContextItem {
  filename: string
  source: 'uploaded' | 'agent' | 'linked'
  description?: string
  url?: string
}

const DEFAULT_LIMIT = 10

// Select + shape pinned artifacts for the prompt. Skips unpinned rows and
// upload-pending rows (no bytes yet). source defaults to 'uploaded' (legacy).
export function selectPinnedArtifacts(
  rows: RawArtifactRow[],
  limit: number = DEFAULT_LIMIT,
): ArtifactContextItem[] {
  return rows
    .filter((r) => r.pinned === true && (r.status ?? 'ready') !== 'pending')
    .slice(0, limit)
    .map((r) => ({
      filename: (r.filename ?? '').trim() || '(unnamed)',
      source: (r.source as ArtifactContextItem['source']) || 'uploaded',
      description: (r.description ?? '').trim() || undefined,
      url: r.source === 'linked' ? r.url : undefined,
    }))
}

// Render the system-prompt block, or null when nothing is pinned.
export function renderArtifactContextBlock(items: ArtifactContextItem[]): string | null {
  if (items.length === 0) return null
  const lines = items.map((it) => {
    const tag = it.source === 'linked' && it.url ? `link: ${it.url}` : it.source
    const desc = it.description ? ` — ${it.description}` : ''
    return `- **${it.filename}** (${tag})${desc}`
  })
  return `
## Key files on this brief

These files and links are pinned to this brief as its load-bearing material. You know they exist, but you have NOT read their contents — unless one is attached directly in this conversation. If something here is relevant, ask the maker about it or ask them to share it; don't guess at what's inside.

${lines.join('\n')}
`.trim()
}
