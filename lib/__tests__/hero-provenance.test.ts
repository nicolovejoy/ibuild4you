import { describe, it, expect } from 'vitest'
import { heroProvenance } from '@/lib/public/hero-provenance'
import { sessionNumberById, decisionProvenanceSuffix } from '@/lib/builder/decision-provenance'
import { publicCopy } from '@/lib/copy-public'
import { HERO_SESSIONS } from '@/lib/public/hero-script'
import type { BriefDecision } from '@/lib/types'

const numbers = sessionNumberById(HERO_SESSIONS)
const d = (extra: Partial<BriefDecision>): BriefDecision => ({ topic: 't', decision: 'x', ...extra })

const stamped = d({
  decided_in_session: 'hero-s1',
  decided_at: '2026-07-11T18:40:00.000Z',
  revised_in_session: 'hero-s4',
  revised_at: '2026-10-17T19:05:00.000Z',
})

describe('heroProvenance', () => {
  it('English output matches the builder helper exactly', () => {
    const en = publicCopy.en.home.provenance
    expect(heroProvenance(stamped, numbers, en)).toBe(decisionProvenanceSuffix(stamped, numbers))
    expect(heroProvenance(stamped, numbers, en)).toBe('conv 1 · Jul 11, revised conv 4 · Oct 17')
  })

  it('French words, French dates, feminine revision', () => {
    const fr = publicCopy.fr.home.provenance
    expect(heroProvenance(stamped, numbers, fr)).toBe('conv. 1 · 11 juil., révisée conv. 4 · 17 oct.')
  })

  it('handles an unknown session and an unstamped decision', () => {
    const fr = publicCopy.fr.home.provenance
    const en = publicCopy.en.home.provenance
    const orphan = d({ decided_at: '2026-07-11T18:40:00.000Z', revised_at: '2026-10-17T19:05:00.000Z' })
    expect(heroProvenance(orphan, numbers, en)).toBe('added Jul 11, revised Oct 17')
    expect(heroProvenance(orphan, numbers, fr)).toBe('ajoutée le 11 juil., révisée le 17 oct.')
    expect(heroProvenance(d({}), numbers, en)).toBeNull()
  })
})
