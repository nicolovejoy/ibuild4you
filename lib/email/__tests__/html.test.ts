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
    const html = textToEmailHtml(
      'Waiting:\n\n• "Cafe" — from Sam\n  https://ibuild4you.com/projects/cafe\n- "Music" — from Owen'
    )
    expect(html).toContain('<ul')
    expect(html.match(/<li[ >]/g)?.length).toBe(2)
    // A bullet's continuation line (indented URL) stays inside that bullet.
    expect(html).toMatch(
      /<li[^>]*>[^<]*Cafe[\s\S]*?href="https:\/\/ibuild4you\.com\/projects\/cafe"[\s\S]*?<\/li>/
    )
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

  it('ends a URL at a quote so it cannot break out of the attribute', () => {
    const html = textToEmailHtml('https://x.com/a"b')
    expect(html).toContain('href="https://x.com/a"')
    expect(html).toContain('</a>&quot;b')
  })

  it('lets long link text wrap on a phone screen', () => {
    const html = textToEmailHtml('https://x.com/' + 'a'.repeat(200))
    expect(html).toMatch(/<a [^>]*style="[^"]*word-break:break-all/)
    expect(html).toContain('overflow-wrap:break-word')
  })

  it('keeps a quoted URL href clean with the entity outside the anchor', () => {
    const html = textToEmailHtml('Go to "https://byside.app/settings" now')
    expect(html).toContain('href="https://byside.app/settings"')
    expect(html).toContain('</a>&quot; now')
  })

  it('keeps an angle-bracketed URL href clean', () => {
    const html = textToEmailHtml('<https://byside.app/x>')
    expect(html).toContain('href="https://byside.app/x"')
    expect(html).toContain('&lt;<a ')
    expect(html).toContain('</a>&gt;')
  })

  it('leaves a closing paren outside the link', () => {
    const html = textToEmailHtml('(see https://x.com/p)')
    expect(html).toContain('href="https://x.com/p"')
    expect(html).toContain('</a>)')
  })

  it('escapes & exactly once in a reset-link shape', () => {
    const url =
      'https://ibuild4you.com/auth/action?mode=resetPassword&oobCode=abc&continueUrl=https%3A%2F%2Fibuild4you.com'
    const html = textToEmailHtml(`Reset: ${url}`)
    expect(html).toContain('resetPassword&amp;oobCode=abc&amp;continueUrl=')
    expect(html).not.toContain('&amp;amp;')
  })

  it('never makes javascript: or data: hrefs', () => {
    const html = textToEmailHtml('javascript:alert(1) data:text/html,hi')
    expect(html).not.toContain('href=')
  })

  it('falls back to a paragraph with a literal bullet for a mixed block', () => {
    const html = textToEmailHtml('• first\nplain line')
    expect(html).not.toContain('<ul')
    expect(html).toContain('<p')
    expect(html).toContain('• first<br>plain line')
  })

  it('includes a minimal head with charset and viewport', () => {
    const html = textToEmailHtml('Hi')
    expect(html).toContain('<html lang="en"><head><meta charset="utf-8">')
    expect(html).toContain('name="viewport"')
  })

  it('puts the background on a wrapper div, not the body', () => {
    const html = textToEmailHtml('Hi')
    expect(html).toMatch(/<body style="margin:0"><div style="[^"]*background:#faf8f3/)
  })
})
