# Remove Wireframes (#195 phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the wireframe / `layout_mockups` feature end to end: prompt, renderer, authoring UI, types, payload fields and docs.

**Architecture:** Phase 1 (#196) already stopped the chat prompt mentioning wireframes unless a builder set `layout_mockups`. This phase removes the remaining code paths. `layout_mockups` stays *accepted and ignored* on `POST /api/projects` and `PATCH /api/projects` for one release so an old importer or saved payload does not 400. Old messages that contain a ```` ```wireframe ```` fence render as the plain text they are (the fence detector only knows `options` afterwards). Nothing is migrated in Firestore: prod has 0 projects with `layout_mockups` and 14 messages with a wireframe fence (checked 2026-10-15 with `scripts/list-layout-mockups.mjs`).

**Tech Stack:** Next.js App Router, TypeScript, vitest, Tailwind.

**Spec:** GitHub issue #195 ("Phase 2, full removal"). The issue text is the spec; there is no separate design doc.

## Global Constraints

- `layout_mockups` on `POST /api/projects` and `PATCH /api/projects`: accepted, never stored, never 400. The create route gets an explicit accept-and-ignore comment; the PATCH route already ignores unknown fields, so dropping the key from `allowed` is enough. File a follow-up issue when this merges to remove the create-route comment and the two tests.
- Do not touch Firestore data. No migration, no backfill.
- Keep the `options` fence behaviour in `MessageContent` exactly as it is (#131).
- The banned-jargon list in `lib/agent/constants.ts` keeps the word "wireframes" (it is a word Sam must not say; it is not a feature reference).
- Run `npm test`, `npm run type-check`, `npm run lint` and `npm run build` before claiming the branch clean. In this checkout `.next/types` exists, so `type-check` covers route exports, but run `build` anyway.
- Commit after each task with the message shown in the task.

## Review Focus

1. A stored message with a complete ```` ```wireframe ```` block renders its text, including the fence, as plain text; it must not render as an empty paragraph or crash. Test pinned to Task 2.
2. A streamed message that ends in an unclosed ```` ```wireframe ```` fence must not show the "Drawing layout…" hint or set `hasIncompleteBlock`. Test pinned to Task 2.
3. A `POST /api/projects` with `layout_mockups: [{...}]` returns 201 and the project document has no `layout_mockups` key. Test pinned to Task 3.
4. A `PATCH /api/projects` with only `layout_mockups` in the body returns 200 and does not write the field. Test pinned to Task 3.
5. Every session snapshot path (`POST /api/projects` first session, `POST /api/sessions`) no longer copies `layout_mockups`, so a legacy project document that still carries the field does not leak it into new sessions. Test pinned to Task 3.

---

### Task 1: Delete the authoring UI, the preview component and the maker panel

The dashboard `MockupEditor` is already dead code: nothing imports it except its own test. `WireframePreview` is used by `MessageContent` (Task 2) and by `MockupsPanel` in the maker view (this task). Delete the panel first so `WireframePreview` has one remaining consumer, then Task 2 deletes the last one and the file.

**Files:**
- Delete: `components/builder/MockupEditor.tsx`
- Delete: `components/builder/__tests__/MockupEditor.test.ts`
- Modify: `components/maker/MakerProjectView.tsx` (lines 14, 45, 199–202, 677–707)
- Modify: `components/maker/__tests__/MakerProjectView.test.tsx` (lines 11, 34)
- Modify: `lib/copy-maker.ts` (lines 142, 330: `layoutIdeas`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `MakerProjectView` no longer exports `MockupsPanel`. `useMakerCopy().chat.layoutIdeas` no longer exists. `WireframePreview` is still imported by `components/ui/MessageContent.tsx` until Task 2.

- [ ] **Step 1: Delete the editor and its test**

```bash
git rm components/builder/MockupEditor.tsx components/builder/__tests__/MockupEditor.test.ts
```

- [ ] **Step 2: Remove the maker-side panel**

In `components/maker/MakerProjectView.tsx`:

Remove line 14:
```ts
import { WireframePreview } from '@/components/ui/WireframePreview'
```

Change line 45 from
```ts
import type { Session, WireframeMockup, ProjectFile } from '@/lib/types'
```
to
```ts
import type { Session, ProjectFile } from '@/lib/types'
```

Remove lines 199–202 (the block and its comment):
```tsx
        {/* Layout mockups from the active session */}
        {activeSession?.layout_mockups && activeSession.layout_mockups.length > 0 && (
          <MockupsPanel mockups={activeSession.layout_mockups} />
        )}
```

Remove the whole `MockupsPanel` function (lines 677–707, from `export function MockupsPanel` through its closing `}`), including the blank line after it.

`ChevronDown`, `ChevronUp`, `Card`, `CardBody` and `useState` are still used elsewhere in the file (FilesPanel and others), so leave the imports alone. Run `npm run lint` afterwards to confirm no unused import remains.

- [ ] **Step 3: Remove the copy key**

In `lib/copy-maker.ts` delete line 142:
```ts
    layoutIdeas: (n: number) => `Layout ideas (${n})`,
```
and line 330 (the French block):
```ts
    layoutIdeas: (n: number) => `Idées de mise en page (${n})`,
```

- [ ] **Step 4: Update the maker view test fixture**

In `components/maker/__tests__/MakerProjectView.test.tsx`:

Line 11 comment: delete the words `mockups panel,` so the list of covered areas no longer names it.

Delete line 34:
```ts
  layout_mockups: [],
```

- [ ] **Step 5: Run the affected tests and type-check**

Run: `npx vitest run components/maker lib/copy-maker` then `npm run type-check`
Expected: all pass, no TypeScript errors. If `type-check` reports `layoutIdeas` or `MockupsPanel` is used somewhere, that is a site this plan missed: remove the usage and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A components/builder components/maker lib/copy-maker.ts
git commit -m "refactor(wireframes): delete MockupEditor and the maker MockupsPanel (#195)"
```

---

### Task 2: Drop wireframe fence detection and delete `WireframePreview`

**Files:**
- Modify: `components/ui/MessageContent.tsx`
- Delete: `components/ui/WireframePreview.tsx`
- Modify: `components/ui/__tests__/MessageContent.test.ts`
- Modify: `lib/copy-maker.ts` (lines 154, 342: `drawingLayout`)

**Interfaces:**
- Consumes: Task 1 removed the other `WireframePreview` consumer.
- Produces: `Segment` is now `{ type: 'text' } | { type: 'options' }`. `parseMessageContent` returns `incompleteKind?: 'options'`. `useMakerCopy().chat.drawingLayout` no longer exists.

- [ ] **Step 1: Rewrite the wireframe tests as plain-text expectations**

In `components/ui/__tests__/MessageContent.test.ts`, delete these tests:
- `parses a single wireframe block`
- `handles text before and after a wireframe block`
- `handles multiple wireframe blocks`
- the two malformed-wireframe tests (`{not valid json}` and `missing title and sections`)
- `detects incomplete block (streaming in progress)`
- `handles complete block followed by incomplete block`
- `handles a wireframe and an options block in the same message`

Add these in their place, directly after the `returns empty segments for empty string` test:

```ts
  // #195 phase 2: wireframe fences are no longer a block type. Old messages
  // that still carry one render as the plain text they are.
  it('treats a legacy wireframe fence as plain text', () => {
    const content = 'Here is the layout:\n\n```wireframe\n{"title":"Layout","sections":[]}\n```\n\nWhat do you think?'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(false)
    expect(segments).toEqual([{ type: 'text', content }])
  })

  it('does not flag an unclosed legacy wireframe fence as a streaming block', () => {
    const content = 'Here is the layout:\n\n```wireframe\n{"title":"Test","sec'
    const { segments, hasIncompleteBlock, incompleteKind } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(false)
    expect(incompleteKind).toBeUndefined()
    expect(segments).toEqual([{ type: 'text', content }])
  })

  it('still detects an unclosed options fence while streaming', () => {
    const content = 'Which way?\n\n```options\n["Pickup", "Deli'
    const { segments, hasIncompleteBlock, incompleteKind } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(true)
    expect(incompleteKind).toBe('options')
    expect(segments).toEqual([{ type: 'text', content: 'Which way?\n\n' }])
  })

  it('keeps a legacy wireframe fence and an options block apart', () => {
    const content =
      '```wireframe\n{"title":"A","sections":[]}\n```\n\nLike this?\n\n```options\n["Yes", "No"]\n```'
    const { segments } = parseMessageContent(content)
    expect(segments.map((s) => s.type)).toEqual(['text', 'options'])
    expect(segments[0]).toEqual({
      type: 'text',
      content: '```wireframe\n{"title":"A","sections":[]}\n```\n\nLike this?\n\n',
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/ui/__tests__/MessageContent.test.ts`
Expected: the four new tests FAIL (the parser still emits `wireframe` segments and flags the unclosed fence). The remaining `options` tests still pass.

- [ ] **Step 3: Remove wireframe handling from the parser and renderer**

In `components/ui/MessageContent.tsx`:

Delete lines 4–5:
```ts
import { WireframePreview } from './WireframePreview'
import type { WireframeMockup } from '@/lib/types'
```

Replace the `Segment` type and its comment (lines 7–11) with:
```ts
// A segment is plain text or an options block (#131).
export type Segment =
  | { type: 'text'; content: string }
  | { type: 'options'; raw: string; parsed: string[] | null }
```

Replace the comment above `parseMessageContent` (lines 13–22) with:
```ts
// Split message content into text and options segments.
//
// How it works:
// 1. We look for complete ```options ... ``` fenced blocks using a regex
// 2. Everything between/around those blocks is plain text
// 3. For each block, we try to parse the JSON inside
// 4. If the JSON is bad, parsed is null → the block is hidden
// 5. If there's an opening fence without a closing ```, that's a
//    streaming-in-progress block → we flag it so the UI can show a hint
//
```

Change the return type's `incompleteKind?: 'wireframe' | 'options'` to `incompleteKind?: 'options'`.

Change the fence regex and the loop body so only `options` is matched:
```ts
  // Match complete ```options\n...\n``` blocks
  const fencePattern = /```options\n([\s\S]*?)```/g
  const segments: Segment[] = []
  let lastIndex = 0

  for (const match of content.matchAll(fencePattern)) {
    // Text before this block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index)
      if (text.trim()) segments.push({ type: 'text', content: text })
    }

    const json = match[1].trim()
    segments.push({ type: 'options', raw: json, parsed: parseOptions(json) })

    lastIndex = match.index + match[0].length
  }
```

Change the unclosed-fence check:
```ts
  // Check if there's an unclosed fence (agent still streaming the block)
  const incompleteMatch = remaining.match(/```options\n[\s\S]*$/)
  if (incompleteMatch) {
    // Text before the incomplete block
    const textBefore = remaining.slice(0, incompleteMatch.index)
    if (textBefore.trim()) segments.push({ type: 'text', content: textBefore })
    return { segments, hasIncompleteBlock: true, incompleteKind: 'options' }
  }
```

Delete the whole `parseWireframe` function.

In the `MessageContent` component: update the comment above it to
```ts
// Render message content, replacing options blocks with choice chips. When
// onOptionSelect is provided the chips are tappable (maker chat, newest
// message); without it they render as a static, muted list (transcripts,
// older messages).
```
Destructure only `{ segments, hasIncompleteBlock }` from `parseMessageContent` (drop `incompleteKind`). In the segment map, after the `options` branch, delete the `// Wireframe segment` branch and the malformed-JSON `<pre>` fallback; the `options` branch is the last one, so end the callback with `return null` after it (TypeScript needs a return on every path). Change the streaming hint to:
```tsx
      {hasIncompleteBlock && (
        <p className="text-xs text-gray-400 italic mt-1 animate-pulse">…</p>
      )}
```

- [ ] **Step 4: Delete the preview component and the copy key**

```bash
git rm components/ui/WireframePreview.tsx
```

In `lib/copy-maker.ts` delete line 154:
```ts
    drawingLayout: 'Drawing layout...',
```
and line 342:
```ts
    drawingLayout: 'Dessin de la mise en page…',
```

- [ ] **Step 5: Run the tests and type-check**

Run: `npx vitest run components/ui` then `npm run type-check` then `npm run lint`
Expected: all pass. If `type-check` reports `WireframePreview` or `drawingLayout` elsewhere, that is a site this plan missed: remove the usage and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A components/ui lib/copy-maker.ts
git commit -m "refactor(wireframes): drop wireframe fence rendering, delete WireframePreview (#195)"
```

---

### Task 3: Stop storing and snapshotting `layout_mockups` on the API

The create and PATCH routes keep *accepting* the field for one release. Create silently drops it. PATCH keeps it in the allowed list so a body that only carries `layout_mockups` is not rejected, but the loop that copies allowed fields skips it.

**Files:**
- Modify: `app/api/projects/route.ts` (lines 191, 310, 362–364, 523)
- Modify: `app/api/sessions/route.ts` (line 103)
- Modify: `app/api/chat/route.ts` (lines 309, 357)
- Modify: `app/api/chat/kickoff/route.ts` (lines 15, 209, 253)
- Modify: `app/api/projects/__tests__/create-project.test.ts` (lines 400, 415, 451, 461, 540, 546)
- Test: `app/api/projects/__tests__/create-project.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `buildSystemPromptParts` and `buildSystemPrompt` are no longer passed `layoutMockups` (Task 4 removes the parameter).

- [ ] **Step 1: Update the create-project tests**

In `app/api/projects/__tests__/create-project.test.ts`:

In the test around line 395 that posts the full config (`layout_mockups: [{ title: 'Layout A', sections: [] }]` on line 400): keep the input line, and change the assertion on line 415 from
```ts
    expect(data.layout_mockups).toEqual([{ title: 'Layout A', sections: [] }])
```
to
```ts
    // #195 phase 2: accepted for one release, never stored.
    expect(data.layout_mockups).toBeUndefined()
```

In the session-snapshot test around line 445 (`layout_mockups: [{ title: 'Mock', sections: [] }]` on line 451): keep the input line, and delete line 461 from the `toMatchObject` block. Then add, right after the `toMatchObject` call:
```ts
    expect(sessions[0]).not.toHaveProperty('layout_mockups')
```

The empty-array test at line 535 already expects `data.layout_mockups` to be undefined. Leave it.

Add one new test after the empty-array test:
```ts
  it('ignores layout_mockups on create without rejecting the request (#195)', async () => {
    const res = await POST(makeRequest({
      title: 'Legacy Payload',
      layout_mockups: [{ title: 'Old', sections: [{ type: 'hero', label: 'Hi', description: 'x' }] }],
    }))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data).not.toHaveProperty('layout_mockups')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/projects/__tests__/create-project.test.ts`
Expected: the changed assertions and the new test FAIL because the route still stores the field.

- [ ] **Step 3: Update the create route**

In `app/api/projects/route.ts`:

Line 310 comment: change `// requester info, session config, and layout mockups.` to `// requester info and session config.`

Delete lines 362–364:
```ts
  if (Array.isArray(body.layout_mockups) && body.layout_mockups.length > 0) {
    projectData.layout_mockups = body.layout_mockups
  }
```
Add in their place:
```ts
  // #195 phase 2: `layout_mockups` is accepted but ignored for one release so
  // older saved payloads do not 400. Remove the field from the docs and then
  // from here once that release has shipped.
```

Line 523, the session snapshot loop: remove `'layout_mockups'` from the array so it reads
```ts
  for (const field of ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'identity'] as const) {
```

- [ ] **Step 4: Update the PATCH route**

Still in `app/api/projects/route.ts`. The PATCH handler (around lines 190–212) builds `patch` by looping `for (const key of allowed) { if (key in updates) patch[key] = updates[key] }`, writes `patch` to Firestore, and returns `{ id, ...patch }`. The PATCH never 400s on unknown fields (it just ignores them), so the simplest correct change is to drop `'layout_mockups'` from the `allowed` array on line 191. A legacy body carrying only `layout_mockups` then gets a 200 with `updated_at` and nothing else written, which is exactly "accepted and ignored". Add a comment directly above the `allowed` line:
```ts
  // #195 phase 2: `layout_mockups` was removed from this list; the PATCH ignores
  // unknown fields, so an older payload that still sends it gets a 200 and no write.
```

Add this test to `app/api/projects/__tests__/update-delete-project.test.ts`, inside `describe('PATCH /api/projects', …)`, directly after the `ignores disallowed fields` test (it uses the same `makePatchRequest` helper and the same `proj-1` fixture):
```ts
  it('accepts layout_mockups without storing it (#195 phase 2)', async () => {
    const res = await PATCH(
      makePatchRequest({
        project_id: 'proj-1',
        layout_mockups: [{ title: 'Old', sections: [] }],
      })
    )
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.id).toBe('proj-1')
    expect(data.layout_mockups).toBeUndefined()
  })
```

- [ ] **Step 5: Update the session route and the two chat routes**

`app/api/sessions/route.ts` line 103:
```ts
  const configFields = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'identity'] as const
```

`app/api/chat/route.ts`: delete line 309 (`const layoutMockups = …`) and line 357 (`    layoutMockups,` inside the `buildSystemPromptParts` call).

`app/api/chat/kickoff/route.ts`: line 15 becomes
```ts
import type { BriefContent, BriefRole } from '@/lib/types'
```
Delete line 209 (`const layoutMockups = …`) and line 253 (`    layoutMockups,`).

- [ ] **Step 6: Run the tests and type-check**

Run: `npx vitest run app/api` then `npm run type-check`
Expected: all pass. `type-check` will still pass with `layoutMockups` absent because the prompt builder's parameter is optional; Task 4 removes it.

- [ ] **Step 7: Commit**

```bash
git add app/api
git commit -m "refactor(wireframes): stop storing and snapshotting layout_mockups; accept-and-ignore on create/PATCH (#195)"
```

---

### Task 4: Remove the prompt block, the types, the client types and the prep-prompt schema

**Files:**
- Modify: `lib/agent/system-prompt.ts` (lines 7, 22, 66, 155–180)
- Modify: `lib/agent/__tests__/system-prompt.test.ts` (lines 117–141)
- Modify: `lib/types/index.ts` (lines 84, 134, 304–315)
- Modify: `lib/query/hooks.ts` (line 330)
- Modify: `lib/api/import-payload.ts` (line 36)
- Modify: `lib/api/__tests__/import-payload.test.ts` (line 100)
- Modify: `lib/agent/new-project-prompt.ts` (lines 31–38)
- Modify: `lib/agent/next-convo-prompt.ts` (lines 44–51)
- Modify: `lib/agent/__tests__/new-project-prompt.test.ts` (line 26)
- Modify: `app/dashboard/page.tsx` (lines 179, 189)
- Regenerate: `lib/agent/__tests__/__snapshots__/prep-prompts-snapshot.test.ts.snap`

**Interfaces:**
- Consumes: Task 3 already stopped passing `layoutMockups` into the prompt builder.
- Produces: `WireframeMockup` and `WireframeSection` no longer exist. `Project.layout_mockups`, `Session.layout_mockups` and the `useUpdateProject` input no longer have the field. `NEXT_CONVO_IMPORT_FIELDS` no longer lists it.

- [ ] **Step 1: Update the system-prompt tests**

In `lib/agent/__tests__/system-prompt.test.ts` delete the three tests at lines 117–141 (`includes layout mockups when provided`, `says nothing about wireframes when the builder set no mockups (#195)`, `omits the wireframe section for an empty mockups array (#195)`) and add one:
```ts
  it('never mentions wireframes or layout mockups (#195 phase 2)', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).not.toContain('## Layout visualization')
    expect(result).not.toContain('## Layout mockups')
    expect(result).not.toContain('```wireframe')
  })
```

- [ ] **Step 2: Run the tests to verify the deleted tests are gone and the new one passes**

Run: `npx vitest run lib/agent/__tests__/system-prompt.test.ts`
Expected: PASS (the prompt already omits the block when no mockups are passed). This step is a baseline, not a red step; the red step for this task is the type-check in Step 6 after the type is deleted.

- [ ] **Step 3: Remove the prompt block and parameter**

In `lib/agent/system-prompt.ts`:

Line 7:
```ts
import type { BriefContent, BriefRole } from '@/lib/types'
```
Delete line 22 (`  layoutMockups?: WireframeMockup[]`).
Line 66: remove `layoutMockups, ` from the destructured parameter list.
Delete lines 155–180: the `// #195: wireframes are only mentioned…` comment and the whole `if (layoutMockups && layoutMockups.length > 0) { … }` block that appends `## Layout mockups`.

- [ ] **Step 4: Delete the types and the client-side field**

In `lib/types/index.ts`:
- Delete line 84 (`  layout_mockups?: WireframeMockup[] // wireframe layouts the agent can show in chat`).
- Delete line 134 (`  layout_mockups?: WireframeMockup[]` on `Session`).
- Delete lines 304–315: the `// Wireframe mockup — …` comment, `WireframeSection` and `WireframeMockup`.

In `lib/query/hooks.ts` delete line 330 (`      layout_mockups?: import('@/lib/types').WireframeMockup[]`).

In `app/dashboard/page.tsx` delete line 179 (`        layout_mockups?: unknown`) and line 189 (the `fields.push(\`${obj.layout_mockups.length} mockup…\`)` line).

- [ ] **Step 5: Remove the field from the prep-prompt schemas and the import list**

`lib/agent/new-project-prompt.ts`: delete lines 31–38, the whole `"layout_mockups": [ … ],` entry, so `"builder_directives"` is followed directly by `"brief"`.

`lib/agent/next-convo-prompt.ts`: delete lines 44–51, the whole `"layout_mockups": [ … ]` entry. It is the last entry in that object, so also remove the trailing comma from the `"builder_directives"` line above it.

`lib/api/import-payload.ts`: delete line 36 (`  'layout_mockups',`).

`lib/api/__tests__/import-payload.test.ts` line 100: change
```ts
      payload[field] = field === 'seed_questions' || field === 'builder_directives' || field === 'layout_mockups'
```
to
```ts
      payload[field] = field === 'seed_questions' || field === 'builder_directives'
```

`lib/agent/__tests__/new-project-prompt.test.ts`: delete line 26 (`  'layout_mockups',`).

- [ ] **Step 6: Type-check, then regenerate the snapshot and run the full suite**

Run: `npm run type-check`
Expected: PASS. Any error naming `WireframeMockup`, `layout_mockups` or `layoutMockups` is a site this plan missed: remove it and note it in the commit body.

Run: `npx vitest run lib/agent/__tests__/prep-prompts-snapshot.test.ts -u`
Expected: the snapshot file is rewritten with no `layout_mockups` entries. Check with `grep -c layout_mockups lib/agent/__tests__/__snapshots__/prep-prompts-snapshot.test.ts.snap` → `0`.

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add lib app/dashboard/page.tsx
git commit -m "refactor(wireframes): remove WireframeMockup types, prompt block and payload schema entries (#195)"
```

---

### Task 5: Docs, changelog and the full verification gate

**Files:**
- Move: `docs/mockup-system.md` → `docs/archive/mockup-system.md`
- Modify: `docs/iteration-architecture.md` (lines 31, 40)
- Modify: `CLAUDE.md` (lines 127, 133, and the Scott line under "Garm cutover is live")
- Modify: `docs/changelog.md` (prepend)

**Interfaces:** none.

- [ ] **Step 1: Archive the mockup doc**

```bash
git mv docs/mockup-system.md docs/archive/mockup-system.md
```
Then insert this as the first line of `docs/archive/mockup-system.md`, above the `# Inline Wireframe Mockup System` heading:
```
> **Archived 2026-10-15.** The wireframe feature was removed in #195 phase 2. Kept for history only.

```

- [ ] **Step 2: Update the architecture doc**

In `docs/iteration-architecture.md` delete line 31:
```
layout_mockups: WireframeMockup[]        (inline wireframes; see mockup-system.md)
```
On line 40 change `layout_mockups, identity` to `identity`.

- [ ] **Step 3: Update CLAUDE.md**

Line 127: replace the whole `layout_mockups` (legacy, optional) paragraph with:
```
`layout_mockups` (retired): wireframes were removed in #195 phase 2 (2026-10-15). Create and PATCH still accept the field and ignore it for one release so older payloads do not fail; drop it from any payload you write.
```

Line 133 (PATCH accepted fields): remove `` `layout_mockups`, `` from the list.

Under **Garm cutover is live**, delete the sentence `Scott's Google-identity alias was requested from Garm 2026-07-30 — verify it landed.` (Resolved 2026-10-15: Scott signs in with the same address that is on his memberships, so no alias was ever needed.)

- [ ] **Step 4: Prepend a changelog entry**

At the top of the dated entries in `docs/changelog.md` (keep whatever header the file has above the first entry), insert:
```
**Shipped 2026-10-15 (#195 phase 2 — wireframes removed):** Deleted `MockupEditor`, `WireframePreview`, the maker `MockupsPanel`, the ```` ```wireframe ```` fence detection in `MessageContent`, the `WireframeMockup`/`WireframeSection` types, the `## Layout mockups` prompt block, and the `layout_mockups` entries in the new-project / next-conversation prep-prompt schemas and `NEXT_CONVO_IMPORT_FIELDS`. `POST`/`PATCH /api/projects` still accept `layout_mockups` and ignore it for one release. Session snapshots no longer copy it. No Firestore migration: prod had 0 projects with the field and 14 old messages with a wireframe fence (now render as plain text). `docs/mockup-system.md` archived. Also closed the Scott Garm-alias thread: same address both sides, nothing to verify.
```

- [ ] **Step 5: Full gate**

Run, in order:
```bash
npm run lint
npm run type-check
npm test
npm run build
```
Expected: all four exit 0. Then:
```bash
grep -rn "layout_mockups\|WireframeMockup\|layoutMockups\|WireframePreview\|MockupEditor\|MockupsPanel\|drawingLayout\|layoutIdeas" app components lib scripts --include='*.ts' --include='*.tsx' --include='*.mjs'
```
Expected: only the #195 comments in `app/api/projects/route.ts` (create-route accept-and-ignore, PATCH `allowed` note), the two accept-and-ignore tests, and `scripts/list-layout-mockups.mjs` (the read-only prod check, kept on purpose).

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs(wireframes): archive mockup-system, update CLAUDE.md and changelog (#195)"
```

- [ ] **Step 7: File the follow-up issue**

```bash
gh issue create --title "Drop layout_mockups accept-and-ignore on POST/PATCH /api/projects" --body "Follow-up to #195 phase 2. The create and PATCH routes still accept \`layout_mockups\` and discard it so pre-removal payloads do not 400. Once one release has shipped with that in place, remove the field from the PATCH \`allowed\` list and the create-route comment, and delete the two accept-and-ignore tests. Also delete \`scripts/list-layout-mockups.mjs\`."
```
Note the issue number in the final report.
