import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BRIEF_CURATION_GUIDE } from '../curation-guide'
import { BRIEF_CHAR_BUDGET } from '../brief-size'

// #229: the comms agent usually runs in claude.ai and cannot open repo files,
// so the guide is a TS constant embedded in the prep. The docs copy is for
// humans; this pins the two equal.
describe('BRIEF_CURATION_GUIDE', () => {
  it('curation guide in docs matches BRIEF_CURATION_GUIDE', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/brief-curation-guide.md'), 'utf8')
    expect(doc).toContain(BRIEF_CURATION_GUIDE)
    expect(doc).toMatch(/lib\/agent\/curation-guide\.ts/)
  })

  it('names the readers, the budget and the hard rules', () => {
    expect(BRIEF_CURATION_GUIDE).toMatch(/Sam/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/comms agent/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/Claude Code/)
    expect(BRIEF_CURATION_GUIDE).toContain(BRIEF_CHAR_BUDGET.toLocaleString('en-US'))
    expect(BRIEF_CURATION_GUIDE).toMatch(/verbatim/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/contested/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/topic/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/owner/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/English/)
  })
})
