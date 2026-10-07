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
//   - everything is HTML-escaped first, URLs included (attribute-safe)

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Match a URL, but let trailing sentence punctuation fall out of the match.
const URL_RE = /https?:\/\/[^\s<]+?(?=[.,;:!?)]*(?:\s|$))/g

// Takes already-escaped text, so the URL is attribute-safe as matched.
function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (url) => `<a href="${url}" style="color:#1f3a5f">${url}</a>`)
}

const BULLET_RE = /^(?:•|-)\s+/

function renderParagraph(block: string): string {
  const lines = block.split('\n')
  const isList =
    BULLET_RE.test(lines[0]) && lines.every((l) => BULLET_RE.test(l) || /^\s+\S/.test(l))

  if (isList) {
    // Each bullet is a list of lines: the bullet text plus any indented
    // continuation lines. Escape + linkify per line, then join with <br>.
    const items: string[][] = []
    for (const line of lines) {
      if (BULLET_RE.test(line)) items.push([line.replace(BULLET_RE, '')])
      else items[items.length - 1].push(line.trim())
    }
    const lis = items.map(
      (parts) =>
        `<li style="margin:0 0 8px 0">${parts.map((p) => linkify(escapeHtml(p))).join('<br>')}</li>`,
    )
    return `<ul style="padding-left:20px;margin:0 0 16px 0">${lis.join('')}</ul>`
  }

  const withBreaks = lines.map((l) => linkify(escapeHtml(l))).join('<br>')
  return `<p style="margin:0 0 16px 0">${withBreaks}</p>`
}

export function textToEmailHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/)
  const body = blocks.map(renderParagraph).join('')
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#faf8f3">',
    '<div style="max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#1f2933">',
    body,
    '</div></body></html>',
  ].join('')
}
