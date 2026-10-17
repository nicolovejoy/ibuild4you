import { describe, it, expect } from 'vitest'
import { unqueuedGreeting } from '../unqueued-greeting'

describe('unqueuedGreeting', () => {
  it('EN uses the builder name', () =>
    expect(unqueuedGreeting('en', 'Nico')).toContain("Nico hasn't queued our next conversation yet"))
  it('EN falls back to "your builder"', () =>
    expect(unqueuedGreeting('en', null)).toContain("your builder hasn't queued"))
  it('FR twin uses the name', () => expect(unqueuedGreeting('fr', 'Nico')).toMatch(/Nico/))
  it('FR falls back', () => expect(unqueuedGreeting('fr', undefined)).toMatch(/votre builder/))
})
