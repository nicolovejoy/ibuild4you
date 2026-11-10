import { describe, it, expect } from 'vitest'
import { publicCopy } from '@/lib/copy-public'
import { heroBriefIds, revealedIds, HERO_SESSIONS, type HeroScript } from '@/lib/public/hero-script'
import { sessionNumberById, decisionProvenanceSuffix } from '@/lib/builder/decision-provenance'

const scripts: Array<[string, HeroScript]> = [
  ['en later', publicCopy.en.home.script.later],
  ['fr later', publicCopy.fr.home.script.later],
]

describe('home page hero script', () => {
  it.each(scripts)('%s: every effect points at a brief line, ids are unique', (_name, script) => {
    const ids = heroBriefIds(script.brief)
    expect(new Set(ids).size).toBe(ids.length)
    for (const turn of script.turns) {
      for (const e of turn.effects ?? []) expect(ids).toContain(e.id)
    }
  })

  it.each(scripts)('%s: only maker turns change the brief', (_name, script) => {
    for (const turn of script.turns) {
      if (turn.role === 'agent') expect(turn.effects ?? []).toHaveLength(0)
    }
  })

  it('the French twin mirrors the English structure (same ids, same turn roles)', () => {
    const en = publicCopy.en.home.script.later
    const fr = publicCopy.fr.home.script.later
    expect(heroBriefIds(fr.brief)).toEqual(heroBriefIds(en.brief))
    expect(fr.turns.map((t) => t.role)).toEqual(en.turns.map((t) => t.role))
    expect(fr.turns.map((t) => t.effects ?? [])).toEqual(en.turns.map((t) => t.effects ?? []))
  })

  it('the brief shows its older lines from the start and every line by the end', () => {
    const s = publicCopy.en.home.script.later
    const atStart = revealedIds(s, 0)
    expect(atStart).toContain('d-channel') // locked in July, untouched this conversation
    expect(atStart).not.toContain('f-shared') // added in this conversation
    expect(revealedIds(s, s.turns.length)).toEqual(new Set(heroBriefIds(s.brief)))
  })

  it('provenance labels resolve against the fixture sessions', () => {
    const numbers = sessionNumberById(HERO_SESSIONS)
    const later = publicCopy.en.home.script.later.brief
    const filter = later.decisions.find((d) => d.id === 'd-filter')!
    expect(decisionProvenanceSuffix(filter, numbers)).toBe(
      'conv 1 · Jul 11, revised conv 4 · Oct 17'
    )
    const who = later.decisions.find((d) => d.id === 'd-who')!
    expect(decisionProvenanceSuffix(who, numbers)).toBe('conv 2 · Aug 3, revised conv 4 · Oct 17')
  })
})
