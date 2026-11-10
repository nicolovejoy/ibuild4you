// The signed-out home page's demo: a scripted intake conversation and the brief
// it produces.
//
// The text itself lives in lib/copy-public.ts (English and French twins); this
// file holds the shape, the fixture sessions the provenance labels point at,
// and the helpers that list a brief's lines.

import type { BriefDecision } from '@/lib/types'

export type HeroRole = 'agent' | 'maker'

// What a maker turn does to the brief: a line appears, or an existing line
// changes. Ids refer to HeroBrief items below.
export interface HeroEffect {
  id: string
  kind: 'add' | 'update'
}

export interface HeroTurn {
  role: HeroRole
  text: string
  effects?: HeroEffect[]
}

export interface HeroBriefLine {
  id: string
  text: string
}

export interface HeroRisk extends HeroBriefLine {
  owner: 'maker' | 'builder'
}

export interface HeroDecision extends BriefDecision {
  id: string
}

export interface HeroBrief {
  title: string
  summary: HeroBriefLine
  features: HeroBriefLine[]
  decisions: HeroDecision[]
  risks: HeroRisk[]
  queued: HeroBriefLine[]
  // "Brief v7 → v8": the version before this conversation and after it.
  versionBefore: number
  versionAfter: number
  conversation: number
}

export interface HeroScript {
  makerName: string
  turns: HeroTurn[]
  brief: HeroBrief
}

// Fixture sessions the decision provenance labels resolve against ("conv 2 ·
// Aug 3"). Dates are mid-day UTC so the Pacific day matches the calendar day.
export const HERO_SESSIONS = [
  { id: 'hero-s1', created_at: '2026-07-11T18:00:00.000Z' },
  { id: 'hero-s2', created_at: '2026-08-03T18:00:00.000Z' },
  { id: 'hero-s3', created_at: '2026-09-14T18:00:00.000Z' },
  { id: 'hero-s4', created_at: '2026-10-17T18:00:00.000Z' },
]

// Every brief line id, in display order.
export function heroBriefIds(brief: HeroBrief): string[] {
  return [
    brief.summary.id,
    ...brief.features.map((f) => f.id),
    ...brief.decisions.map((d) => d.id),
    ...brief.risks.map((r) => r.id),
    ...brief.queued.map((q) => q.id),
  ]
}

// Ids of the lines that exist once `turnsShown` turns have played. A line with
// no effect anywhere in the script is treated as present from the start (the
// page shows a mature brief whose older lines predate the conversation).
export function revealedIds(script: HeroScript, turnsShown: number): Set<string> {
  const touched = new Set(script.turns.flatMap((t) => (t.effects ?? []).map((e) => e.id)))
  const shown = new Set<string>()
  for (const id of heroBriefIds(script.brief)) if (!touched.has(id)) shown.add(id)
  for (const turn of script.turns.slice(0, turnsShown)) {
    for (const e of turn.effects ?? []) shown.add(e.id)
  }
  return shown
}
