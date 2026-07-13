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

// Render brief.md — project meta + latest brief + reviewer annotations.
// `sessions` must already be archived-excluded and sorted oldest-first (so
// index+1 is the conversation number for #121 decision provenance). Returns
// markdown with a trailing newline (matches what the exporter writes to disk).
export function renderBriefMd({ project, brief, sessions, reviews }) {
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
  if (project.context) b.push(`\n## Builder-provided context\n\n${project.context}`)
  if (brief) {
    const c = brief.content || {}
    b.push(`\n## Problem\n\n${c.problem || '—'}`)
    b.push(`\n## Target users\n\n${c.target_users || '—'}`)
    b.push(`\n## Features\n`)
    for (const f of c.features || []) b.push(`- ${f}`)
    if (!(c.features || []).length) b.push('—')
    b.push(`\n## Constraints\n\n${c.constraints || '—'}`)
    if (c.additional_context) b.push(`\n## Additional context\n\n${c.additional_context}`)
    if ((c.decisions || []).length) {
      b.push(`\n## Decisions\n`)
      // #121: provenance suffix — sessions here are already archived-excluded
      // and sorted oldest-first, so index+1 is the conversation number.
      const convNumber = new Map(sessions.map((s, i) => [s.id, i + 1]))
      for (const d of c.decisions) {
        let prov = ''
        if (d.decided_at) {
          const date = d.decided_at.slice(0, 10)
          const n = d.decided_in_session ? convNumber.get(d.decided_in_session) : undefined
          prov = n ? ` _(decided conv ${n}, ${date})_` : ` _(added ${date})_`
        }
        b.push(`- **${d.topic}**: ${d.decision}${d.locked ? ' _(locked)_' : ''}${prov}`)
      }
    }
    if ((c.open_risks || []).length) {
      b.push(`\n## Open risks\n`)
      for (const r of c.open_risks) b.push(`- ${r}`)
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
