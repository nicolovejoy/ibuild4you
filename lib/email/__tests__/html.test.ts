import { describe, it, expect } from 'vitest'
import { textToEmailHtml } from '../html'

describe('textToEmailHtml', () => {
  it('wraps the body in a document with a readable base font', () => {
    const html = textToEmailHtml('Hello')
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).toContain('font-size:16px')
    expect(html).toContain('<p')
    expect(html).toContain('Hello')
  })

  it('splits paragraphs on blank lines and keeps single newlines as line breaks', () => {
    const html = textToEmailHtml('Line one\nLine two\n\nSecond para')
    expect(html.match(/<p[ >]/g)?.length).toBe(2)
    expect(html).toContain('Line one<br>Line two')
  })

  it('turns bullet lines into a list', () => {
    const html = textToEmailHtml('Waiting:\n\n• "Cafe" — from Sam\n  https://ibuild4you.com/projects/cafe\n- "Music" — from Owen')
    expect(html).toContain('<ul')
    expect(html.match(/<li[ >]/g)?.length).toBe(2)
    // A bullet's continuation line (indented URL) stays inside that bullet.
    expect(html).toMatch(/<li[^>]*>[^<]*Cafe[\s\S]*?href="https:\/\/ibuild4you\.com\/projects\/cafe"[\s\S]*?<\/li>/)
  })

  it('escapes HTML special characters so titles never become markup', () => {
    const html = textToEmailHtml('Sam & Co <beta>')
    expect(html).toContain('Sam &amp; Co &lt;beta&gt;')
    expect(html).not.toContain('<beta>')
  })

  it('links bare URLs and leaves trailing sentence punctuation outside the href', () => {
    const html = textToEmailHtml('Open https://ibuild4you.com/projects/cafe.')
    expect(html).toContain('<a href="https://ibuild4you.com/projects/cafe"')
    expect(html).toContain('</a>.')
  })

  it('escapes a URL that carries a quote so it cannot break out of the attribute', () => {
    const html = textToEmailHtml('https://x.com/a"b')
    expect(html).not.toContain('href="https://x.com/a"b"')
    expect(html).toContain('&quot;')
  })
})
