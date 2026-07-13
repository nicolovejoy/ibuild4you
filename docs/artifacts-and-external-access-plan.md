# #83 artifacts + #133 external access: plan (PROPOSED 2026-07-12)

One plan, two issues, because they interlock: #133's external reader should see
artifacts, so #83's schema must carry what an outside agent needs (`source`,
`description`, `url`). Build order is #133 first (small, independent), then #83
phases. Target: one Opus build session (two if Phase C makes the cut).

## Decisions already made (context for the builder)

- #133 shape: **local read-only MCP server**, not a remote endpoint — rejected
  a new authed PII surface when the reader is on this machine (2026-07-07
  export-pipeline decision). Write path stays out (#84 cost-routing: brief
  edits ride Nico's Max sub, never the metered API).
- #83 storage: **evolve the existing `files` collection in place** — additive
  fields, no migration, no rename of collection/type. `message.file_ids`,
  folders (#23b), S3 flow, and every hook keep working untouched. A new
  `artifacts` collection was considered and rejected: big-bang migration risk
  for zero data-model win (the issue's "one collection with source + kind" is
  satisfied by `files` + fields).
- No hard deletes, additive schema, pure helpers TDD-first — house rules apply.

---

# Part 1 — #133: MCP server over briefs (build FIRST)

## Shape

`scripts/mcp-briefs.mjs` — stdio MCP server (`@modelcontextprotocol/sdk`),
launched through the existing read-only wrapper so writes are physically
impossible (datastore.viewer key):

```
node scripts/with-prod-env-ro.mjs node scripts/mcp-briefs.mjs --repo nicolovejoy/byside
```

`--repo` is required and scopes every tool to projects whose `github_repo`
matches (same `normalizeRepo` matching as `export-brief.mjs` — bare name,
owner/name, full URL all match). A host repo's server only ever sees its own
briefs. No flag = refuse to start (fail closed; an unscoped server would leak
every brief into whatever repo registered it).

## Extract shared rendering first

`export-brief.mjs` already renders brief.md + session-NN.md correctly
(provenance suffixes, archived-session exclusion, attachment names). Pull the
formatting into `scripts/lib/brief-markdown.mjs`:

- `renderBriefMd(project, brief, sessions, reviews, fileNames)` → string
- `renderSessionMd(project, session, n, total, messages, fileNames)` → string
- `normalizeRepo(v)` (moves here from export-brief)

`export-brief.mjs` becomes a thin caller. MCP server imports the same module —
one rendering, two consumers. TDD the pure renderers (they're currently
untested inside the script).

## Tools (v1)

- `list_briefs` → `[{ slug, title, brief_version, updated_at, conversations }]`
  for the scoped repo. No PII beyond titles.
- `get_brief { slug }` → brief.md content (same markdown as the export).
- `get_conversation { slug, n }` → session-NN.md content.
- `get_artifacts { slug }` → `[{ filename, source, description, url?, pinned,
  folder, size_bytes, content_type, created_at }]` — metadata only, no bytes
  (transcript attachments already surface inline as names). Works day one on
  the current schema (`source` defaults to `uploaded`); gets richer as #83
  lands.

Every tool re-checks the slug belongs to the scoped repo (defense in depth —
don't trust the client to only ask for its own slugs).

## Registration

Per-consumer-repo `.mcp.json` (byside, prntd), checked in — safe because the
command line contains no secrets, only the wrapper path:

```json
{
  "mcpServers": {
    "ibuild-briefs": {
      "command": "node",
      "args": [
        "/Users/nico/src/ibuild4you/scripts/with-prod-env-ro.mjs",
        "node", "/Users/nico/src/ibuild4you/scripts/mcp-briefs.mjs",
        "--repo", "nicolovejoy/byside"
      ]
    }
  }
}
```

(Absolute paths are fine — this is a this-machine tool by design. If the
consumer repos already have `.mcp.json`, merge.)

## Keep / retire

- `export-brief.mjs` STAYS (file-drop pattern for consumers without MCP, e.g.
  Cowork). It just gets thinner.
- The gitignored `ibuild-export/` drops stay valid; refresh cadence becomes
  "whenever, or just use the MCP".

## Tests + verify (#133)

- TDD: `brief-markdown` renderers (fixture project → exact markdown, incl.
  provenance suffix + archived-exclusion), repo-scope filter, slug-outside-scope
  rejection.
- Verify live: launch the server scoped to byside, drive it with a raw
  JSON-RPC stdio probe script (`scripts/e2e-133-mcp-probe.mjs` — initialize,
  list tools, call each, grade shapes), then register in byside and confirm a
  Claude Code session there can `list_briefs` + `get_brief`.

---

# Part 2 — #83: artifacts (build SECOND)

## Schema (additive on `ProjectFile` / `files`)

```ts
// all optional — absent means legacy upload, everything keeps working
source?: 'uploaded' | 'agent' | 'linked'   // absent = 'uploaded'
url?: string          // linked artifacts only; such docs have no storage_path
description?: string  // one line, human- or agent-written; feeds agent context + MCP
pinned?: boolean      // load-bearing artifact — sorts first, named in agent prompt
created_by_role?: 'maker' | 'builder' | 'agent'  // coarse attribution (#43-lite)
```

Rules a pure helper enforces (`lib/files/artifacts.ts`, TDD):
- `linked` ⇒ `url` required, no `storage_path`/`size_bytes`; validate http(s).
- `uploaded`/`agent` ⇒ `storage_path` required (agent output goes to S3 like
  any upload — no second byte-store).
- `pinned` cap: soft-limit 5 per project (a 6th pin returns 400 with "unpin
  something first" — the whole point is scarcity; an unbounded pin list is
  just the file list again).

## Phase A — links + pinning + description

- `PATCH /api/files/[fileId]` (exists for folder moves) additionally accepts
  `{ pinned }` and `{ description }` — builder+ for both (same gate as move).
- `POST /api/files/link` — builder+ creates a linked artifact
  `{ url, filename (display name), description?, folder_id? }`. No S3 leg.
- UI (builder Attachments): "Add link" next to "New folder"; pin toggle (star)
  on cards + preview modal; pinned section sorts first; linked cards open the
  URL (no download/preview), show a link glyph.
- Maker view: sees pins + links read-only (same pattern as folder list).
- Delete/folders/preview: linked artifacts flow through existing paths (delete
  skips S3 — the tolerant delete already handles docs with no storage_path).

## Phase B — pinned artifacts enter agent context

Mirror the `prototype-context` pattern exactly (fetch helper + renderer +
honesty guardrail, failure never breaks chat):

- `lib/agent/artifact-context.ts`: render a `## Key files on this brief`
  block from pinned artifacts — filename, source, description, url for links.
  Names + descriptions ONLY, never bytes (bytes still ride `file_ids`
  attachments; this block is so Sam knows what exists and can ask the maker to
  attach or discuss it).
- Guardrail line: "you know these files exist; you have NOT read their
  contents unless attached in this conversation."
- Wire into chat + kickoff prompt assembly next to `prototypeContext`.

## Phase C — first agent-generated artifact (GATED — see open question 2)

Smallest real producer: **save a wireframe from chat**. Agent-emitted
```wireframe blocks are ephemeral today (live only inside message content).
A "Save layout" button on rendered `WireframePreview` in chat → `POST
/api/files/agent-artifact` → JSON to S3, doc with `source: 'agent'`,
`created_by_role: 'agent'`, description auto-set from the wireframe title.
Preview modal renders it via the existing `WireframePreview`. Nothing else —
no versioning, no agent-initiated saves (the human clicks the button; the
agent doesn't get a tool yet).

## Naming (UI only — see open question 1)

Collection, type, routes all keep `files` (rename = churn, zero user value).
UI label via `lib/copy.ts`: makers keep **"Files"** (plain language rule —
"Artifacts" is builder jargon); builder view can adopt "Artifacts" when
Phase C gives it a reason. Default if undecided: leave every label alone.

## Deferred (explicitly out)

- Per-artifact visibility by brief_role (issue Q3) — no concrete ask yet;
  schema leaves room (`visibility?` later). Revisit when a builder actually
  wants to hide something.
- Importance *ranking* beyond pinned/unpinned — measurement minimalism.
- Artifact versioning, agent tool-use writes, cross-brief artifacts.
- Full #43 voice-attribution — `created_by_role` is the 80% version.

## Tests + verify (#83)

- TDD: `lib/files/artifacts.ts` validators; PATCH pinned/description auth +
  pin-cap; POST link validation; artifact-context renderer (empty → no block).
- Preview e2e `e2e-83-artifacts.mjs`: add link → pin it → maker sees pinned
  section read-only → live chat probe: Sam names the pinned artifact when
  asked "what files do we have?" and admits it hasn't read them → unpin →
  block gone from a fresh reply. (Poll the display-name gate in a loop — #39
  gotcha.)
- After Phase A ships: `get_artifacts` in the #133 server + an artifacts
  section in `export-brief.mjs` brief.md pick up the new fields (one small
  follow-through commit, both consumers read the same docs).

---

## Build order for the Opus session

1. #133: extract `brief-markdown.mjs` (TDD) → thin export-brief → MCP server →
   stdio probe → register in byside, live-verify. **PR 1.**
2. #83 Phase A (TDD route/helper work, then UI) → preview e2e. **PR 2.**
3. #83 Phase B + the #133/`export-brief` artifacts follow-through. **PR 3.**
4. Phase C only if 1–3 land with room to spare (or its own later session).

## Open questions (answer before the build session)

1. **UI naming** — keep "Files" everywhere for now (my default), or rename the
   builder-side label to "Artifacts" already in Phase A?
2. **Phase C in scope?** Save-wireframe-as-artifact is the first agent-produced
   artifact and makes the "Artifacts" story real, but it's cuttable. In the
   Opus session or parked?
3. **MCP registration** — checked-in `.mcp.json` in byside/prntd (my default;
   no secrets in it, absolute paths acceptable for a this-machine tool), or
   your global `~/.claude` config instead?
