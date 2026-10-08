// Renders one of our plain-text email bodies as HTML. The TEXT body stays the
// source of truth (all copy lives in lib/copy.ts and the pure builders); this
// derives the HTML from it so the two can never say different things.
//
// Rules, in order:
//   - paragraphs split on blank lines; single newlines become <br>
//   - a paragraph whose lines all start with "• " or "- " becomes a <ul>;
//     an indented continuation line (e.g. the URL under a digest bullet)
//     belongs to the bullet above it
//   - bare http(s) URLs become anchors; trailing .,;:!?) stays outside
//   - linkified on the raw text, then every piece is HTML-escaped once

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Match a URL in RAW text. URL characters exclude whitespace and <>"' so a
// quote or bracket ends the link; trailing sentence punctuation falls out.
const URL_RE = /https?:\/\/[^\s<>"']+?(?=[.,;:!?)]*(?:[\s<>"']|$))/g

// Linkify raw text, escaping each piece exactly once. The URL is escaped once
// and used for both the href and the visible text. word-break:break-all keeps
// long links (e.g. Firebase reset links) from overflowing a phone screen.
function renderInline(raw: string): string {
  let out = ''
  let last = 0
  for (const m of raw.matchAll(URL_RE)) {
    const start = m.index ?? 0
    out += escapeHtml(raw.slice(last, start))
    const url = escapeHtml(m[0])
    out += `<a href="${url}" style="color:#1f3a5f;word-break:break-all">${url}</a>`
    last = start + m[0].length
  }
  return out + escapeHtml(raw.slice(last))
}

const BULLET_RE = /^(?:•|-)\s+/

function renderParagraph(block: string): string {
  const lines = block.split('\n')
  const isList =
    BULLET_RE.test(lines[0]) && lines.every((l) => BULLET_RE.test(l) || /^\s+\S/.test(l))

  if (isList) {
    // Each bullet is a list of lines: the bullet text plus any indented
    // continuation lines. Linkify + escape per line, then join with <br>.
    const items: string[][] = []
    for (const line of lines) {
      if (BULLET_RE.test(line)) items.push([line.replace(BULLET_RE, '')])
      else items[items.length - 1].push(line.trim())
    }
    const lis = items.map(
      (parts) => `<li style="margin:0 0 8px 0">${parts.map(renderInline).join('<br>')}</li>`
    )
    return `<ul style="padding-left:20px;margin:0 0 16px 0">${lis.join('')}</ul>`
  }

  const withBreaks = lines.map(renderInline).join('<br>')
  return `<p style="margin:0 0 16px 0">${withBreaks}</p>`
}

export function textToEmailHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/)
  const body = blocks.map(renderParagraph).join('')
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0">',
    // Gmail drops <body> styles, so background + padding live on a wrapper.
    '<div style="padding:24px;background:#faf8f3">',
    '<div style="overflow-wrap:break-word;max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f2933">',
    body,
    '</div></div></body></html>',
  ].join('')
}
