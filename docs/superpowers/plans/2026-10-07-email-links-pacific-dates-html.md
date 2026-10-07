# Email links, Pacific dates, HTML body — Implementation Plan (#181)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every outbound email we build (builder digest, maker reminder, feedback notification) ships a text body AND an HTML body with clickable links, and any timestamp shown is Pacific with the zone named.

**Architecture:** Two tiny pure helpers in `lib/email/` — `formatPacific()` for dates and `textToEmailHtml()` that renders our existing plain-text bodies into a styled HTML email (paragraphs, bullet lists, URLs → anchors). The three pure email builders keep returning `text` (so existing copy and tests stay byte-identical where possible) and additionally return `html`. The three send sites pass both to Resend. No new copy is authored; the HTML is derived from the text so the two never drift.

**Tech Stack:** TypeScript, Vitest, Resend SDK (`emails.send` accepts `text` + `html`), `Intl.DateTimeFormat`.

**Spec:** GitHub issue #181 (https://github.com/nicolovejoy/ibuild4you/issues/181). Design decisions recorded here because Nico delegated the design ("do all you can on your own", 2026-10-07).

## Global Constraints

- "UTC at rest, Pacific on display": storage stays ISO UTC; every human-facing date uses `America/Los_Angeles` via `Intl.DateTimeFormat`, never `toISOString().slice(0,10)` or `toLocaleString()` without a zone.
- Keep text bodies as the source of truth; `html` is derived from `text`. Never author HTML-only copy.
- Never log email addresses or bodies beyond what the existing dry-run logs already do.
- Code style: clear over clever, comment the non-obvious. Follow the existing pure-builder + route pattern.
- Run `npm test`, `npm run type-check`, `npm run lint` before every commit. In a worktree also run `npm run build` before claiming clean (CLAUDE.md: type-check alone is a false green in a worktree).

## Review Focus

1. A text body containing `<`, `>` or `&` (a maker title like `Sam & Co <beta>`) must render escaped in HTML, never as markup — Task 1 pins this.
2. A URL at the end of a sentence followed by punctuation (`https://x.com/p.`) must not swallow the trailing `.` into the href — Task 1 pins this.
3. A pendingSince that is not a valid ISO string must not throw and must not print `Invalid Date` — Task 1 pins `formatPacific` returning `''` and Task 2 pins the digest omitting the clause.
4. A January timestamp must say `PST`, a July one `PDT` — Task 1 pins both.
5. Dry-run reminder sends must still not call Resend, and the Resend call must carry both `text` and `html` — Task 3 pins this.

---

### Task 1: Pure helpers — `formatPacific` and `textToEmailHtml`

**Files:**
- Create: `lib/email/format.ts`
- Create: `lib/email/html.ts`
- Test: `lib/email/__tests__/format.test.ts`
- Test: `lib/email/__tests__/html.test.ts`

**Interfaces:**
- Produces: `formatPacific(iso: string | null | undefined): string` — `'Jun 15, 2026, 5:00 AM PDT'` style; `''` for empty/invalid input.
- Produces: `textToEmailHtml(text: string): string` — full HTML document string for one email body.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/email/__tests__/format.test.ts
import { describe, it, expect } from 'vitest'
import { formatPacific } from '../format'

describe('formatPacific', () => {
  it('renders a summer UTC instant in Pacific Daylight Time with the zone named', () => {
    expect(formatPacific('2026-06-15T12:00:00.000Z')).toBe('Jun 15, 2026, 5:00 AM PDT')
  })

  it('renders a winter UTC instant in Pacific Standard Time', () => {
    expect(formatPacific('2026-01-15T12:00:00.000Z')).toBe('Jan 15, 2026, 4:00 AM PST')
  })

  it('rolls the calendar day back when UTC is already tomorrow', () => {
    // 01:30Z on the 16th is 6:30 PM on the 15th in LA.
    expect(formatPacific('2026-06-16T01:30:00.000Z')).toBe('Jun 15, 2026, 6:30 PM PDT')
  })

  it('returns an empty string for empty or invalid input instead of "Invalid Date"', () => {
    expect(formatPacific('')).toBe('')
    expect(formatPacific(null)).toBe('')
    expect(formatPacific(undefined)).toBe('')
    expect(formatPacific('not-a-date')).toBe('')
  })
})
```

```ts
// lib/email/__tests__/html.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/email/__tests__/format.test.ts lib/email/__tests__/html.test.ts`
Expected: FAIL — cannot resolve `../format` / `../html`.

- [ ] **Step 3: Implement `formatPacific`**

```ts
// lib/email/format.ts
// Human-facing timestamps for outbound email. Storage is ISO UTC everywhere;
// a person reading an email is on Nico's clock, so we render in Pacific and
// NAME the zone (PDT/PST) so "5:00 AM" is never ambiguous. Shared convention:
// "UTC at rest, Pacific on display" (CLAUDE.md).

const PACIFIC = 'America/Los_Angeles'

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

// '2026-06-15T12:00:00.000Z' → 'Jun 15, 2026, 5:00 AM PDT'. Empty or
// unparseable input → '' so a caller can simply omit the clause; we never
// want "Invalid Date" in a maker's inbox.
export function formatPacific(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatter.format(d)
}
```

- [ ] **Step 4: Implement `textToEmailHtml`**

```ts
// lib/email/html.ts
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

function linkify(escaped: string): string {
  return escaped.replace(URL_RE, (url) => `<a href="${url}" style="color:#1f3a5f">${url}</a>`)
}

const BULLET_RE = /^(?:•|-)\s+/

function renderParagraph(block: string): string {
  const lines = block.split('\n')
  const isList = lines.every((l) => BULLET_RE.test(l) || /^\s+\S/.test(l)) && BULLET_RE.test(lines[0])

  if (isList) {
    const items: string[] = []
    for (const line of lines) {
      if (BULLET_RE.test(line)) items.push(line.replace(BULLET_RE, ''))
      else items[items.length - 1] += '<br>' + line.trim()
    }
    const lis = items.map((it) => `<li style="margin:0 0 8px 0">${linkify(escapeHtml(it).replace(/&lt;br&gt;/g, '<br>'))}</li>`)
    return `<ul style="padding-left:20px;margin:0 0 16px 0">${lis.join('')}</ul>`
  }

  return `<p style="margin:0 0 16px 0">${linkify(escapeHtml(lines.join('\n'))).replace(/\n/g, '<br>')}</p>`
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
```

Note for the implementer: the list branch escapes each item BEFORE joining continuation lines, so build items as plain strings, then `escapeHtml` each, then `linkify`, then join continuation lines with `<br>`. Rewrite the loop so no `&lt;br&gt;` replace hack is needed:

```ts
    const items: string[][] = []
    for (const line of lines) {
      if (BULLET_RE.test(line)) items.push([line.replace(BULLET_RE, '')])
      else items[items.length - 1].push(line.trim())
    }
    const lis = items.map(
      (parts) => `<li style="margin:0 0 8px 0">${parts.map((p) => linkify(escapeHtml(p))).join('<br>')}</li>`,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/email/__tests__/format.test.ts lib/email/__tests__/html.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/email/format.ts lib/email/html.ts lib/email/__tests__/format.test.ts lib/email/__tests__/html.test.ts
git commit -m "feat(email): formatPacific + textToEmailHtml helpers (#181)"
```

---

### Task 2: Builder digest — Pacific "since", HTML body, route passes both

**Files:**
- Modify: `lib/api/notify-digest.ts`
- Modify: `app/api/cron/notify-digest/route.ts` (the `emails.send` call)
- Test: `lib/api/__tests__/notify-digest.test.ts`

**Interfaces:**
- Consumes: `formatPacific`, `textToEmailHtml` from Task 1.
- Produces: `Digest` gains `html: string`.

- [ ] **Step 1: Update the tests**

Replace the `since` assertion and add HTML assertions in `lib/api/__tests__/notify-digest.test.ts`:

```ts
  it('lists each brief with title, maker, link, and a Pacific since-time', () => {
    const d = buildDigest([item()])!
    expect(d.text).toContain('"Sam Cafe App" — from Sam')
    expect(d.text).toContain('https://ibuild4you.com/projects/sam-cafe')
    expect(d.text).toContain('(since Jun 15, 2026, 5:00 AM PDT)')
    expect(d.text).not.toContain('2026-06-15T12:00:00.000Z')
  })

  it('omits the since clause when pendingSince is absent or unparseable', () => {
    expect(buildDigest([item({ pendingSince: null })])!.text).not.toContain('since')
    expect(buildDigest([item({ pendingSince: 'garbage' })])!.text).not.toContain('since')
    expect(buildDigest([item({ pendingSince: 'garbage' })])!.text).not.toContain('Invalid')
  })

  it('ships an HTML body with each brief as a clickable link', () => {
    const d = buildDigest([item(), item({ title: 'Owen Music', url: 'https://ibuild4you.com/projects/owen', makerName: 'Owen' })])!
    expect(d.html).toContain('<a href="https://ibuild4you.com/projects/sam-cafe"')
    expect(d.html).toContain('<a href="https://ibuild4you.com/projects/owen"')
    expect(d.html.match(/<li[ >]/g)?.length).toBe(2)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/api/__tests__/notify-digest.test.ts`
Expected: FAIL on the Pacific string and on `d.html` being undefined.

- [ ] **Step 3: Implement**

```ts
// lib/api/notify-digest.ts  (replace the body of the file below the imports)
import { formatPacific } from '@/lib/email/format'
import { textToEmailHtml } from '@/lib/email/html'

export interface DigestItem {
  title: string
  url: string
  makerName: string
  pendingSince?: string | null
}

export interface Digest {
  subject: string
  text: string
  html: string
}

// Returns null when there's nothing pending — the cron should send no email.
export function buildDigest(items: DigestItem[]): Digest | null {
  if (items.length === 0) return null

  const n = items.length
  const subject = n === 1 ? `1 brief has new messages` : `${n} briefs have new messages`

  const lines = items.map((it) => {
    // Pacific, zone named (#181). formatPacific returns '' for missing or
    // unparseable input, in which case we drop the clause entirely.
    const when = formatPacific(it.pendingSince)
    const since = when ? ` (since ${when})` : ''
    return [`• "${it.title}" — from ${it.makerName}${since}`, `  ${it.url}`].join('\n')
  })

  const text = [
    n === 1
      ? 'This brief has new messages waiting for you:'
      : 'These briefs have new messages waiting for you:',
    '',
    ...lines,
  ].join('\n')

  return { subject, text, html: textToEmailHtml(text) }
}
```

In `app/api/cron/notify-digest/route.ts`, change the send call to:

```ts
    await getResend().emails.send({
      from: 'iBuild4you <noreply@ibuild4you.com>',
      to: NOTIFICATION_EMAILS,
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    })
```

Note: `lines` joins the bullets with `'\n'` (no blank line between), so `textToEmailHtml` sees them as ONE paragraph block whose lines all start with `• ` or are indented — that is exactly the list branch. Do not insert blank lines between bullets.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/api/__tests__/notify-digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api/notify-digest.ts app/api/cron/notify-digest/route.ts lib/api/__tests__/notify-digest.test.ts
git commit -m "feat(email): builder digest shows Pacific since-time and ships HTML (#181)"
```

---

### Task 3: Maker reminder emails — HTML body on both send paths

**Files:**
- Modify: `lib/email/reminder-digest.ts` (`buildReminderEmail` return type)
- Modify: `lib/email/send-reminder.ts` (both `emails.send` calls + `buildBody` path)
- Modify: `lib/email/send-maker-email.ts` (optional `html`, default derived)
- Test: `lib/email/__tests__/reminder-digest.test.ts`
- Test: `lib/email/__tests__/send-reminder.test.ts`
- Test: `lib/email/__tests__/send-maker-email.test.ts`

**Interfaces:**
- Consumes: `textToEmailHtml` from Task 1.
- Produces: `buildReminderEmail(batch): { subject; text; html }`; `SendMakerEmailInput.html?: string`.

- [ ] **Step 1: Add failing tests**

Append to `lib/email/__tests__/reminder-digest.test.ts` (inside the existing `describe` for `buildReminderEmail`, or a new one if there is none):

```ts
  it('returns an HTML body whose share links are anchors', () => {
    const { html } = buildReminderEmail({
      email: 'sam@example.com',
      firstName: 'Sam',
      items: [
        { projectId: 'p1', makerEmail: 'sam@example.com', makerFirstName: 'Sam', projectTitle: 'Cafe', shareLink: 'https://ibuild4you.com/projects/cafe', sessionNumber: 2, reminderNumber: 1 },
        { projectId: 'p2', makerEmail: 'sam@example.com', makerFirstName: 'Sam', projectTitle: 'Music', shareLink: 'https://ibuild4you.com/projects/music', sessionNumber: null, reminderNumber: 1 },
      ],
    })
    expect(html).toContain('<a href="https://ibuild4you.com/projects/cafe"')
    expect(html).toContain('<a href="https://ibuild4you.com/projects/music"')
  })
```

In `lib/email/__tests__/send-reminder.test.ts`, extend the first test (`sends via Resend ...`) with:

```ts
    expect(call.html).toContain('<a href="https://ibuild4you.com/projects/sams-cafe"')
    expect(call.html).toMatch(/^<!doctype html>/i)
```

and, if the file has a `sendReminderDigest` describe block, add the same two `call.html` assertions to its happy-path test. If it does not, add:

```ts
import { sendReminderDigest } from '../send-reminder'

describe('sendReminderDigest', () => {
  beforeEach(() => { sendMock.mockReset(); delete process.env.REMINDER_DRY_RUN; process.env.RESEND_API_KEY = 'fake-key' })

  it('passes both text and html to Resend', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_d' }, error: null })
    await sendReminderDigest({
      email: 'sam@example.com',
      firstName: 'Sam',
      items: [{ projectId: 'p1', makerEmail: 'sam@example.com', makerFirstName: 'Sam', projectTitle: 'Cafe', shareLink: 'https://ibuild4you.com/projects/cafe', sessionNumber: 1, reminderNumber: 1 }],
    })
    const call = sendMock.mock.calls[0][0]
    expect(call.text).toContain('https://ibuild4you.com/projects/cafe')
    expect(call.html).toContain('<a href="https://ibuild4you.com/projects/cafe"')
  })
})
```

In `lib/email/__tests__/send-maker-email.test.ts`, add to the happy-path test:

```ts
    expect(call.html).toMatch(/^<!doctype html>/i)
```

and a new test:

```ts
  it('uses caller-supplied html when given', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_h' }, error: null })
    await sendMakerEmail({ to: 'a@example.com', subject: 's', text: 'plain', html: '<p>custom</p>' })
    expect(sendMock.mock.calls[0][0].html).toBe('<p>custom</p>')
  })
```

(Read the existing file first and match its mock setup and input shape exactly.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/email`
Expected: new assertions FAIL on `html` undefined.

- [ ] **Step 3: Implement**

`lib/email/reminder-digest.ts` — change the return type and both branches:

```ts
import { textToEmailHtml } from '@/lib/email/html'
// ...
export function buildReminderEmail(batch: MakerBatch): { subject: string; text: string; html: string } {
  if (batch.items.length === 1) {
    const item = batch.items[0]
    const text = singleBriefBody(item)
    return { subject: copy.email.subject.reminder(item.projectTitle), text, html: textToEmailHtml(text) }
  }
  const text = multiBriefBody(batch)
  return { subject: `Your conversations are waiting (${batch.items.length} briefs)`, text, html: textToEmailHtml(text) }
}
```

`lib/email/send-reminder.ts`:
- import `textToEmailHtml`;
- in `sendReminderEmail`, after `const text = buildBody(input)` add `const html = textToEmailHtml(text)` and pass `html` in the `emails.send` object;
- in `sendReminderDigest`, destructure `{ subject, text, html }` from `buildReminderEmail(batch)` and pass `html` in `emails.send`.
Dry-run branches are unchanged (they never call Resend).

`lib/email/send-maker-email.ts`:

```ts
import { textToEmailHtml } from '@/lib/email/html'
// in SendMakerEmailInput:
  text: string
  // Optional HTML body. When omitted we derive it from `text` so every email
  // we send has clickable links (#181). Pass your own only if you have a
  // reason to diverge from the text.
  html?: string
// in the send call:
    text: input.text,
    html: input.html ?? textToEmailHtml(input.text),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/email`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email
git commit -m "feat(email): maker reminders and builder-sent emails ship an HTML body (#181)"
```

---

### Task 4: Feedback notification — HTML with a clickable Review link

**Files:**
- Modify: `lib/feedback/notify-email.ts`
- Modify: `app/api/feedback/route.ts` (the `emails.send` call near line 312)
- Test: `lib/feedback/__tests__/notify-email.test.ts`

**Interfaces:**
- Consumes: `textToEmailHtml` from Task 1.
- Produces: `buildFeedbackEmail(input): { subject; text; html }`.

- [ ] **Step 1: Add failing test**

Append to `lib/feedback/__tests__/notify-email.test.ts` (reuse the file's existing `baseInput()` helper):

```ts
describe('buildFeedbackEmail — html body', () => {
  it('links the review URL and the page URL, and escapes the body', () => {
    const { html } = buildFeedbackEmail(baseInput({ body: 'Button <b>broken</b> & ugly', pageUrl: 'https://byside.app/settings' }))
    expect(html).toContain('<a href="https://ibuild4you.com/admin/feedback?focus=')
    expect(html).toContain('<a href="https://byside.app/settings"')
    expect(html).toContain('Button &lt;b&gt;broken&lt;/b&gt; &amp; ugly')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/feedback/__tests__/notify-email.test.ts`
Expected: FAIL — `html` undefined.

- [ ] **Step 3: Implement**

In `lib/feedback/notify-email.ts`: import `textToEmailHtml`, change the return type to `{ subject: string; text: string; html: string }`, and end with `return { subject, text, html: textToEmailHtml(text) }`.

In `app/api/feedback/route.ts`: destructure `const { subject, text, html } = buildFeedbackEmail({...})` and add `html,` to the `resend.emails.send({...})` object.

- [ ] **Step 4: Run tests, then the full gate**

Run: `npx vitest run lib/feedback/__tests__/notify-email.test.ts` → PASS.
Run: `npm test && npm run type-check && npm run lint && npm run build` → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/feedback/notify-email.ts app/api/feedback/route.ts lib/feedback/__tests__/notify-email.test.ts
git commit -m "feat(email): feedback notification ships HTML with clickable review link (#181)"
```

---

### Task 5: Changelog entry

**Files:**
- Modify: `docs/changelog.md` (prepend)

- [ ] **Step 1: Prepend an entry**

```markdown
## 2026-10-07 — Outbound email: HTML bodies, clickable links, Pacific times (#181)

Builder digest, maker reminders, builder-sent emails and feedback notifications now send `text` + `html`. HTML is derived from the text body by `lib/email/html.ts` (paragraphs, bullet lists, URLs → anchors, everything escaped), so copy still lives in one place. The digest's `(since …)` clause is Pacific with the zone named (`lib/email/format.ts`), not a raw ISO UTC string. Not touched: the interest-form and feedback-reply sends (`app/api/interest`, `app/api/admin/feedback/[id]`) — still text-only.
```

- [ ] **Step 2: Commit**

```bash
git add docs/changelog.md
git commit -m "docs: changelog — outbound email HTML + Pacific times (#181)"
```
