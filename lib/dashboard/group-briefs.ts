import { makerCopy } from '@/lib/copy-maker'
import type { Locale } from '@/lib/locale'
import { getTurnIndicator, type TurnState } from '@/lib/turn-indicator'
import { viewerBriefRole } from '@/lib/roles/display'
import { projectActivityKey } from '@/lib/api/sort-projects-by-activity'
import type { Project } from '@/lib/types'

// Groups dashboard briefs into role/turn-state sections (#44). Pure: derives
// everything from each enriched project (its viewer_role / viewer_brief_role /
// turn fields), so it's fully unit-testable with no React or data fetching.

export type SectionKey = 'awaiting' | 'yours' | 'reviewing' | 'contributing' | 'done' | 'archived'

export interface BriefSection {
  key: SectionKey
  title: string
  briefs: Project[]
  /** One-line hint shown when a role section is empty; undefined elsewhere. */
  emptyHint?: string
}

// Fixed render order. Awaiting (today's action list) first; the two collapsed
// folders (Done, then Archived) last.
const SECTION_ORDER: SectionKey[] = ['awaiting', 'yours', 'reviewing', 'contributing', 'done', 'archived']

// Titles and hints come from the maker copy, so the dashboard reads in the
// viewer's language.
function sectionMeta(key: SectionKey, locale: Locale): { title: string; emptyHint?: string } {
  const sections = makerCopy[locale].dashboard.sections
  const meta: { title: string; emptyHint?: string } = sections[key]
  return { title: meta.title, emptyHint: meta.emptyHint }
}

const ROLE_SECTION = {
  originator: 'yours',
  reviewer: 'reviewing',
  contributor: 'contributing',
} as const

// Lower rank sorts first within a section. your_turn outranks needs_setup so
// the brief actually awaiting a reply leads the Awaiting-you list.
const URGENCY: Record<TurnState, number> = {
  your_turn: 0,
  needs_setup: 1,
  waiting: 2,
  completed: 3,
}

function turnStateFor(project: Project): TurnState | null {
  return getTurnIndicator(project, project.viewer_role ?? null)?.state ?? null
}

function sectionFor(project: Project): SectionKey {
  // Archive is a manual "hide from active view" and wins over everything,
  // including completed — an archived brief belongs in the Archived folder.
  if (project.viewer_archived) return 'archived'
  if (project.status === 'completed') return 'done'
  const turn = turnStateFor(project)
  if (turn === 'your_turn' || turn === 'needs_setup') return 'awaiting'
  const role = viewerBriefRole(project.viewer_role, project.viewer_brief_role)
  return ROLE_SECTION[role]
}

// Sort by turn urgency, then by activity (newest first) as the tiebreaker.
function sortSection(briefs: Project[]): Project[] {
  return [...briefs].sort((a, b) => {
    const ua = URGENCY[turnStateFor(a) ?? 'waiting']
    const ub = URGENCY[turnStateFor(b) ?? 'waiting']
    if (ua !== ub) return ua - ub
    return projectActivityKey(b).localeCompare(projectActivityKey(a))
  })
}

export function groupBriefs(projects: Project[], locale: Locale = 'en'): BriefSection[] {
  const buckets: Record<SectionKey, Project[]> = {
    awaiting: [],
    yours: [],
    reviewing: [],
    contributing: [],
    done: [],
    archived: [],
  }
  for (const p of projects) buckets[sectionFor(p)].push(p)

  return SECTION_ORDER.map((key) => ({
    key,
    ...sectionMeta(key, locale),
    briefs: sortSection(buckets[key]),
  }))
}

// Render flat (no section headers) when sectioning earns nothing: a single
// non-empty bucket, or a small enough total that grouping is just noise.
const FLATTEN_THRESHOLD = 3

export function shouldFlatten(sections: BriefSection[]): boolean {
  // Any archived brief forces the sectioned view: the flat list renders every
  // brief inline, which would defeat archiving. Keep the collapsed folder.
  const hasArchived = sections.some((s) => s.key === 'archived' && s.briefs.length > 0)
  if (hasArchived) return false
  const nonEmpty = sections.filter((s) => s.briefs.length > 0)
  const total = nonEmpty.reduce((n, s) => n + s.briefs.length, 0)
  return nonEmpty.length <= 1 || total <= FLATTEN_THRESHOLD
}
