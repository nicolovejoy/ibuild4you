import { describe, it, expect } from 'vitest'
import { unqueuedGreeting } from '../unqueued-greeting'

describe('unqueuedGreeting', () => {
  it('EN greets the maker by first name and names nobody else', () => {
    const text = unqueuedGreeting('en', 'Mara')
    expect(text).toBe(
      "Hi Mara. Nothing new from my side today. If something's on your mind, tell me and I'll take notes so it gets picked up.",
    )
    expect(text).not.toMatch(/builder/i)
  })
  it('EN without a name drops the name', () => {
    expect(unqueuedGreeting('en', null)).toMatch(/^Hi\. Nothing new from my side today\./)
    expect(unqueuedGreeting('en', '  ')).toMatch(/^Hi\. Nothing new/)
  })
  it('FR twin uses the name', () =>
    expect(unqueuedGreeting('fr', 'Mara')).toBe(
      "Bonjour Mara. Rien de nouveau de mon côté aujourd'hui. Si quelque chose vous préoccupe, dites-le-moi et je prendrai des notes pour que ce soit repris.",
    ))
  it('FR without a name', () => expect(unqueuedGreeting('fr', undefined)).toMatch(/^Bonjour\. Rien de nouveau/))
})
