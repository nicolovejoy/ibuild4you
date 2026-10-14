import { describe, it, expect } from 'vitest'
import { briefPreviewMeta, previewCopy, conversationsLine, truncateTitle } from '../preview-copy'

describe('briefPreviewMeta', () => {
  it('uses the brief title and the brief language', () => {
    const meta = briefPreviewMeta({ title: 'Le café de Sam', language: 'fr', hideTitle: false })
    expect(meta.title).toBe('Le café de Sam')
    expect(meta.description).toBe(previewCopy.fr.brief.description)
    expect(meta.ogLocale).toBe('fr_FR')
  })

  it('falls back to the anonymous title when the builder hid it', () => {
    const meta = briefPreviewMeta({ title: 'Secret project', language: 'en', hideTitle: true })
    expect(meta.title).toBe('A brief on iBuild4you')
    expect(meta.title).not.toContain('Secret')
    expect(meta.ogLocale).toBe('en_US')
  })

  it('treats a missing or unknown language as English', () => {
    expect(briefPreviewMeta({ title: 'X', language: undefined, hideTitle: false }).ogLocale).toBe('en_US')
    expect(briefPreviewMeta({ title: 'X', language: 'de', hideTitle: true }).title).toBe('A brief on iBuild4you')
  })

  it('uses the anonymous title when the brief has no title', () => {
    expect(briefPreviewMeta({ title: '  ', language: 'fr', hideTitle: false }).title).toBe('Un brief sur iBuild4you')
  })
})

describe('conversationsLine', () => {
  it('pluralises in English and French', () => {
    expect(conversationsLine('en', 1)).toBe('1 conversation so far')
    expect(conversationsLine('en', 3)).toBe('3 conversations so far')
    expect(conversationsLine('fr', 1)).toBe('1 conversation jusqu’ici')
    expect(conversationsLine('fr', 2)).toBe('2 conversations jusqu’ici')
  })

  it('shows the tagline when there are no conversations yet', () => {
    expect(conversationsLine('fr', 0)).toBe(previewCopy.fr.home.footer)
  })
})

describe('truncateTitle', () => {
  it('leaves short titles alone and cuts long ones with an ellipsis', () => {
    expect(truncateTitle('Short')).toBe('Short')
    const long = 'a'.repeat(120)
    const cut = truncateTitle(long)
    expect(cut.length).toBeLessThanOrEqual(70)
    expect(cut.endsWith('…')).toBe(true)
  })
})
