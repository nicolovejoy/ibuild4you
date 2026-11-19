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

  it('says when to send a patch and when a whole rewrite', () => {
    expect(BRIEF_CURATION_GUIDE).toContain('Patch or whole rewrite')
    expect(BRIEF_CURATION_GUIDE).toMatch(/"brief_patch"/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/Only a whole rewrite clears a text field/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/shipped batches/)
  })

  it('asks a patch only for drops it can express', () => {
    expect(BRIEF_CURATION_GUIDE).toContain('In a patch, a whole entry goes in "drop"; detail inside an entry or a text field goes by restating that entry or field without it.')
  })

  it('says a patch can merge two features by dropping both and adding one', () => {
    expect(BRIEF_CURATION_GUIDE).toMatch(/dropping both and adding one/)
  })

  it('has one rule for a queued item that shipped, by a note or a report', () => {
    expect(BRIEF_CURATION_GUIDE).toMatch(/by a note or a build report/)
    expect(BRIEF_CURATION_GUIDE).toMatch(/else the latest batch's date, else today/)
  })

  it('scopes carrying shipped and queued forward to a whole rewrite', () => {
    expect(BRIEF_CURATION_GUIDE).not.toMatch(/^- Always carry "shipped" and "queued" forward:/m)
    expect(BRIEF_CURATION_GUIDE).toMatch(/In a whole rewrite, always carry "shipped" and "queued" forward/)
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
