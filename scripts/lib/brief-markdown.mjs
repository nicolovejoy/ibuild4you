// Shared brief/transcript markdown rendering — one source of truth for two
// consumers: the file-drop exporter (export-brief.mjs) and the read-only MCP
// server (mcp-briefs.mjs). Keep these pure (no I/O): callers fetch Firestore
// docs and pass plain objects in, so the renderers stay testable and the
// output is byte-identical wherever a brief is surfaced.

// Normalize a github_repo value to "owner/name" (lowercased). Stored values
// vary: "owner/name", bare "name", or a full https URL.
export const normalizeRepo = (v) =>
  (v || '')
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')

// Does a stored github_repo match a wanted "owner/name"? Bare stored values
// ("byside") match by name so a repo labelled either way is found.
export const repoMatches = (storedGithubRepo, wantRepo) => {
  const stored = normalizeRepo(storedGithubRepo)
  if (!stored) return false
  const want = normalizeRepo(wantRepo)
  const wantName = want.split('/').pop()
  return stored === want || stored === wantName
}

const day = (iso) => (iso || '').slice(0, 10)

// Decision provenance days are Pacific, not UTC (#228). 'en-CA' formats as YYYY-MM-DD.
const pacificDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

// Pacific "YYYY-MM-DD HH:MM PT" (24-hour) for the coverage line.
// Returns null for a stamp that does not parse, so one bad value cannot abort the render.
const pacificMinute = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type).value
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} PT`
}

// Notes not yet folded into a curated brief (no folded_at), oldest first.
// Pure: takes note docs as plain objects, returns a new array.
export function unfoldedNotes(noteDocs) {
  return noteDocs
    .filter((n) => !n.folded_at)
    .sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''))
}

// An open risk is a plain string or { text, owner } (#220); same form wherever
// risks are listed.
const riskLine = (r) => (typeof r === 'string' ? `- ${r}` : r.owner ? `- (${r.owner}) ${r.text}` : `- ${r.text}`)

// Render brief.md — project meta + latest brief + reviewer annotations.
// Sections, in order: Decisions, Open risks, Shipped, Queued, New since the
// brief was last curated (notes), Files & artifacts, Reviewer annotations.
// Notes render only when `notes` is an array; undefined keeps the old output.
// Left out on purpose: thumbs-down on notes and note ids (not for readers).
// `sessions` must already be archived-excluded and sorted oldest-first (so
// index+1 is the conversation number for #121 decision provenance). Returns
// markdown with a trailing newline (matches what the exporter writes to disk).
export function renderBriefMd({ project, brief, sessions, reviews, files = [], notes }) {
  const slug = project.slug || project.id
  const b = []
  b.push(`# Brief: ${project.title}`)
  b.push('')
  b.push(
    `Exported from ibuild4you.com prod. Project slug: \`${slug}\`. Status: ${project.status || 'active'}.`
  )
  b.push(
    `Conversations: ${sessions.length}. Brief version: ${brief ? brief.version : 'none yet'} (updated ${brief ? day(brief.updated_at) : '—'}).`
  )
  // Coverage: how far the notes reach and when the maker last wrote, so a
  // reader can judge how stale the brief is. No line when neither is known.
  const coverage = []
  // The epoch is NOTHING_COVERED_YET in app/api/projects/email-in/route.ts: no notes yet.
  const notesThroughAt =
    project.notes_through_at === '1970-01-01T00:00:00.000Z' ? null : project.notes_through_at
  const notesThrough = notesThroughAt ? pacificMinute(notesThroughAt) : null
  const makerLast = project.last_maker_message_at ? pacificMinute(project.last_maker_message_at) : null
  if (notesThrough) coverage.push(`Notes cover conversations through ${notesThrough}.`)
  if (makerLast) coverage.push(`Maker last wrote ${makerLast}.`)
  if (coverage.length) b.push(coverage.join(' '))
  if (project.context) b.push(`\n## Builder-provided context\n\n${project.context}`)
  if (brief) {
    const c = brief.content || {}
    // #121: sessions here are already archived-excluded and sorted oldest-first,
    // so index+1 is the conversation number (decisions and notes both use it).
    const convNumber = new Map(sessions.map((s, i) => [s.id, i + 1]))
    b.push(`\n## Problem\n\n${c.problem || '—'}`)
    b.push(`\n## Target users\n\n${c.target_users || '—'}`)
    b.push(`\n## Features\n`)
    for (const f of c.features || []) b.push(`- ${f}`)
    if (!(c.features || []).length) b.push('—')
    b.push(`\n## Constraints\n\n${c.constraints || '—'}`)
    if (c.additional_context) b.push(`\n## Additional context\n\n${c.additional_context}`)
    if ((c.decisions || []).length) {
      b.push(`\n## Decisions\n`)
      for (const d of c.decisions) {
        // #218: a revision keeps the origin and appends "; revised …".
        const parts = []
        if (d.decided_at) {
          const date = pacificDay(d.decided_at)
          const n = d.decided_in_session ? convNumber.get(d.decided_in_session) : undefined
          parts.push(n ? `decided conv ${n}, ${date}` : `added ${date}`)
        }
        if (d.revised_at) {
          const date = pacificDay(d.revised_at)
          const n = d.revised_in_session ? convNumber.get(d.revised_in_session) : undefined
          parts.push(n ? `revised conv ${n}, ${date}` : `revised ${date}`)
        }
        // #197: a contested lock shows what the maker asked for.
        const contest =
          d.locked && d.contested
            ? ` _(contested: maker asked for "${d.contested.proposed}"; ${d.contested.reason})_`
            : ''
        const prov = parts.length ? ` _(${parts.join('; ')})_` : ''
        b.push(`- **${d.topic}**: ${d.decision}${d.locked ? ' _(locked)_' : ''}${contest}${prov}`)
      }
    }
    if ((c.open_risks || []).length) {
      b.push(`\n## Open risks\n`)
      for (const r of c.open_risks) b.push(riskLine(r))
    }
    // #219: dated batches of what went out, newest first. Skip malformed ones.
    const shipped = (Array.isArray(c.shipped) ? c.shipped : [])
      .filter(
        (s) =>
          s &&
          typeof s.date === 'string' &&
          s.date &&
          Array.isArray(s.items) &&
          s.items.some((i) => typeof i === 'string')
      )
      .sort((x, y) => y.date.localeCompare(x.date))
    if (shipped.length) {
      b.push(`\n## Shipped`)
      for (const batch of shipped) {
        b.push('', `### ${batch.date}`)
        for (const item of batch.items) if (typeof item === 'string') b.push(`- ${item}`)
      }
    }
    const queued = (Array.isArray(c.queued) ? c.queued : []).filter((q) => typeof q === 'string')
    if (queued.length) {
      b.push(`\n## Queued\n`)
      for (const q of queued) b.push(`- ${q}`)
    }
    // Notes written since the brief was last curated. Old notes may lack any
    // list, so every list defaults to empty.
    if (Array.isArray(notes)) {
      b.push(`\n## New since the brief was last curated`, '')
      if (!notes.length) {
        b.push('No new notes since the brief was last curated.')
      } else {
        b.push('These notes are not in the brief above yet. Where a note and the brief disagree, the note is newer.')
        for (const note of notes) {
          const n = note.session_id ? convNumber.get(note.session_id) : undefined
          b.push('', `### ${pacificDay(note.created_at)}${n ? `, conversation ${n}` : ''}`)
          const text = (note.text || '').trim()
          if (text) b.push('', text)
          // One labelled sub-list, blank line before it, only when non-empty.
          const sub = (label, lines) => {
            if (lines.length) b.push('', label, ...lines)
          }
          sub('Decisions:', (note.decisions || []).map((d) => `- ${d.topic}: ${d.decision}`))
          sub('New open risks:', (note.risks_added || []).map(riskLine))
          sub(
            'Risks settled:',
            (note.risks_resolved || []).map((r) =>
              typeof r === 'string' ? `- ${r}` : r.resolution ? `- ${r.text} → ${r.resolution}` : `- ${r.text}`
            )
          )
          sub(
            'Maker asked to reverse a locked decision (on the brief as contested):',
            (note.lock_reversals || []).map((l) => `- ${l.topic}: wants "${l.proposed}" (${l.reason})`)
          )
        }
      }
    }
  }
  if (files.length) {
    b.push(`\n## Files & artifacts\n`)
    // Pinned first (they're the ones builders marked as load-bearing), then by
    // upload date. #83 fields (url/description/pinned) are additive — plain
    // uploads render with just a name and date.
    const sorted = [...files].sort(
      (x, y) =>
        (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) ||
        (x.created_at || '').localeCompare(y.created_at || '')
    )
    for (const f of sorted) {
      const parts = [`- **${f.filename || f.id}**`]
      if (f.description) parts.push(` — ${f.description}`)
      if (f.url) parts.push(` — ${f.url}`)
      const meta = [f.pinned ? 'pinned' : null, f.created_at ? `added ${day(f.created_at)}` : null]
        .filter(Boolean)
        .join(', ')
      if (meta) parts.push(` _(${meta})_`)
      b.push(parts.join(''))
    }
  }
  if (reviews.some((r) => (r.annotations || []).length)) {
    b.push(`\n## Reviewer annotations\n`)
    for (const r of reviews) {
      for (const a of r.annotations || []) {
        b.push(`- [${a.section}] ${a.comment} _(${day(a.created_at)})_`)
      }
    }
  }
  return b.join('\n') + '\n'
}

// Render one conversation transcript. `messages` must be sorted oldest-first.
// `n` is the 1-based conversation number, `total` the conversation count.
// Returns markdown with NO trailing newline (matches the exporter's write).
export function renderSessionMd({ project, session, n, total, messages, fileNames }) {
  const m = []
  m.push(`# ${project.title} — conversation ${n} of ${total}`)
  m.push('')
  m.push(`Started ${day(session.created_at)}. Status: ${session.status}. Messages: ${messages.length}.`)
  if (session.summary) m.push(`\nSummary: ${session.summary}`)
  m.push('')
  for (const msg of messages) {
    const who =
      msg.role === 'agent'
        ? 'Agent (Sam)'
        : msg.sender_display_name || msg.sender_email || 'Maker'
    m.push(`## ${who} — ${day(msg.created_at)}`)
    m.push('')
    m.push(msg.content || '')
    if ((msg.file_ids || []).length) {
      m.push('')
      m.push(`_Attached: ${msg.file_ids.map((fid) => fileNames.get(fid) || fid).join(', ')}_`)
    }
    m.push('')
  }
  return m.join('\n')
}
