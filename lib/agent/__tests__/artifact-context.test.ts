import { describe, it, expect } from 'vitest'
import { selectPinnedArtifacts, renderArtifactContextBlock } from '../artifact-context'

// =============================================================================
// ARTIFACT CONTEXT (#83 Phase B) — pinned artifacts into the agent prompt
// =============================================================================

describe('selectPinnedArtifacts', () => {
  it('keeps only pinned, ready artifacts and shapes them', () => {
    const items = selectPinnedArtifacts([
      { filename: 'deck.pdf', pinned: true, source: 'uploaded', description: 'the pitch' },
      { filename: 'notes.txt', pinned: false },
      { filename: 'Figma', pinned: true, source: 'linked', url: 'https://figma.com/x' },
      { filename: 'half.png', pinned: true, status: 'pending' },
    ])
    expect(items).toEqual([
      { filename: 'deck.pdf', source: 'uploaded', description: 'the pitch', url: undefined },
      { filename: 'Figma', source: 'linked', description: undefined, url: 'https://figma.com/x' },
    ])
  })

  it('defaults source to uploaded and caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ filename: `f${i}`, pinned: true }))
    const items = selectPinnedArtifacts(many, 5)
    expect(items).toHaveLength(5)
    expect(items[0].source).toBe('uploaded')
  })

  it('returns [] when nothing is pinned', () => {
    expect(selectPinnedArtifacts([{ filename: 'a', pinned: false }])).toEqual([])
  })
})

describe('renderArtifactContextBlock', () => {
  it('returns null when empty', () => {
    expect(renderArtifactContextBlock([])).toBeNull()
  })

  it('renders a block with the honesty guardrail and per-item lines', () => {
    const block = renderArtifactContextBlock([
      { filename: 'deck.pdf', source: 'uploaded', description: 'the pitch' },
      { filename: 'Figma', source: 'linked', url: 'https://figma.com/x' },
    ])!
    expect(block).toContain('## Key files on this brief')
    expect(block).toContain('have NOT read')
    expect(block).toContain('deck.pdf')
    expect(block).toContain('the pitch')
    expect(block).toContain('https://figma.com/x')
  })
})
