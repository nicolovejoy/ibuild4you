# Brief Ferry Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the builder's Brief tab into a copy/paste "ferry desk": three timestamps, one big paste box, two actions, everything else behind a Details twiddle; surface the same stamps on dashboard rows.

**Architecture:** Two new client-set ISO fields on `projects` (`prep_copied_at`, `payload_pasted_at`) ride the existing PATCH allowlist. A pure helper in `lib/builder/ferry-stamps.ts` turns a `Project` into the three-stamp model (incl. the "newer than paste" rule). A presentational `FerryDesk` component renders stamps, paste box, actions and the Details shell; `BriefTab` in `BuilderProjectView.tsx` keeps the fetch/import logic and passes props. The dashboard row reuses the helper.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4, React Query, vitest (+ jsdom + @testing-library/react for components), Firestore Admin SDK.

**Spec:** `docs/superpowers/specs/2026-10-17-brief-ferry-desk-design.md`

## Global Constraints

- Timestamps stored as UTC ISO strings; displayed in `America/Los_Angeles` (use `Intl.DateTimeFormat`, never `toISOString().slice`).
- All user-facing strings live in `lib/copy.ts` (`copy.brief`, `copy.dashboard`).
- Client data access only through `apiFetch` / React Query hooks; no client Firestore.
- Keep `autoOpenImport` (dispatch modal → focus paste box) working.
- Component tests: `// @vitest-environment jsdom` header, mock `@/lib/query/hooks` like `components/builder/__tests__/BriefHistory.test.tsx`.
- Run `npm run build` AND `npm run type-check` before claiming clean (worktree gotcha in CLAUDE.md).
- Branch: `brief-ferry-desk` off `main` (after `git pull --rebase`). Commits small; no push to `preview` without Nico.

## Review Focus

1. Maker activity exists but nothing ever pasted → stamp must read as "newer than paste" (hot), not silent. Test in Task 1.
2. `payload_pasted_at` written only after Import fully succeeds (brief saved AND any project config PATCH). A failed config PATCH must not stamp. Test in Task 3 (FerryDesk receives `onImport`; stamping stays in BriefTab, covered by Task 4's manual check and the Task 1 helper).
3. Esc in a non-empty paste box must not navigate away (would lose a pasted payload). Test in Task 3.
4. Unparseable / missing timestamps render as "never" / "—", never "Invalid Date". Test in Task 1.
5. Dashboard row for a brief with no maker yet (no `last_maker_message_at`) shows no hot marker and no crash. Test in Task 1.

---

### Task 1: Stamp model helper

**Files:**
- Create: `lib/builder/ferry-stamps.ts`
- Test: `lib/builder/__tests__/ferry-stamps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FerryStamp = { at: string | null; absolute: string; relative: string }
  export type FerryStamps = {
    copied: FerryStamp
    pasted: FerryStamp & { version: number | null }
    maker: FerryStamp & { who: string | null; newerThanPaste: boolean }
  }
  export function ferryStamps(project: Pick<Project, 'prep_copied_at' | 'payload_pasted_at' | 'last_maker_message_at' | 'brief_version' | 'requester_first_name' | 'requester_email'>, now?: Date): FerryStamps
  export function makerNewerThanPaste(p: { last_maker_message_at?: string | null; payload_pasted_at?: string | null }): boolean
  export function formatStampPacific(iso: string | null | undefined): string  // 'Oct 17, 9:14 AM' style, '' on bad input
  ```
- `relative` uses `formatRelativeTime(iso, 'en', now)` from `lib/copy-maker.ts`; `''` when `at` is null.
- `who` = `requester_first_name` else the local part of `requester_email`, else null.

- [ ] **Step 1: Write the failing tests**

```ts
describe('makerNewerThanPaste', () => {
  it('true when maker message is after the last paste', ...)        // 2026-10-17T18:00Z vs paste 2026-10-16T23:40Z → true
  it('false when the paste is newer', ...)
  it('true when maker activity exists and nothing was ever pasted', ...)
  it('false when there is no maker activity', ...)
})
describe('ferryStamps', () => {
  it('formats Pacific absolute + relative for each stamp', ...)      // '2026-10-17T16:14:00.000Z' → absolute matches /Oct 17.*9:14 AM/
  it('uses nulls and empty strings when a field is missing', ...)    // at:null, absolute:'', relative:''
  it('never yields "Invalid Date" for garbage input', ...)
  it('picks who from first name, then email local part', ...)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/builder/__tests__/ferry-stamps.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/builder/ferry-stamps.ts`** per the Interfaces block. Pacific formatter: `new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })`.

- [ ] **Step 4: Run tests, expect PASS.**

- [ ] **Step 5: Commit** — `feat(brief): ferry stamp model helper`

---

### Task 2: Persist the two stamps

**Files:**
- Modify: `lib/types/index.ts` (Project interface, next to `last_nudged_at`)
- Modify: `app/api/projects/route.ts:193` (allowlist)
- Modify: `lib/query/hooks.ts:311` `useUpdateProject` input type if it enumerates fields (check; add the two keys if so)
- Test: `app/api/projects/__tests__/update-delete-project.test.ts`
- Docs: `CLAUDE.md` PATCH field list (add `prep_copied_at`, `payload_pasted_at`)

**Interfaces:**
- Produces: `Project.prep_copied_at?: string`, `Project.payload_pasted_at?: string`; PATCH accepts both.

- [ ] **Step 1: Add a failing test** in the existing PATCH suite: builder PATCHes `{ project_id, prep_copied_at: '2026-10-17T16:14:00.000Z', payload_pasted_at: '2026-10-17T16:20:00.000Z' }` → 200 and the Firestore update payload contains both keys verbatim.

- [ ] **Step 2: Run** `npx vitest run app/api/projects/__tests__/update-delete-project.test.ts` → FAIL (keys dropped).

- [ ] **Step 3: Implement**: add both keys to `allowed`, add the fields + a one-line comment each to `Project`, update the CLAUDE.md PATCH sentence.

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit** — `feat(projects): accept prep_copied_at / payload_pasted_at on PATCH`

---

### Task 3: `FerryDesk` presentational component

**Files:**
- Create: `components/builder/FerryDesk.tsx`
- Modify: `lib/copy.ts` (`copy.brief`: add `stampCopied: 'Prep copied'`, `stampPasted: 'Payload pasted'`, `stampMaker: 'Last maker activity'`, `never: 'never'`, `newerThanPaste: 'newer than your paste'`, `importButton` stays, `copyPrep: 'Copy next-convo prep'`, `copied: 'Copied!'`, `details: 'Details'`, `detailsHint: 'brief · history · regenerate · attachments'`, `escHint: 'Esc back to dashboard'`, `pastePlaceholder: 'Paste the JSON from your prep chat here…'`, `versionLine: (v: number | null, s: number) => …`)
- Test: `components/builder/__tests__/FerryDesk.test.tsx`

**Interfaces:**
- Consumes: `FerryStamps` from Task 1.
- Produces:
  ```tsx
  export function FerryDesk(props: {
    stamps: FerryStamps
    briefVersion: number | null
    sessionCount: number
    pasteValue: string
    onPasteChange: (v: string) => void
    pasteError: string | null
    importing: boolean
    onImport: () => void
    copyingPrep: boolean
    prepCopied: boolean          // 2s "Copied!" flash state owned by parent
    onCopyPrep: () => void
    onEscapeEmpty: () => void    // parent navigates to /dashboard
    textareaRef?: React.Ref<HTMLTextAreaElement>
    children: React.ReactNode    // Details body
  }): JSX.Element
  ```
- Layout (option B): stamps row (3 cards, maker card gets `border-brand-navy` + the `newerThanPaste` sub-line when hot) → textarea `className="… min-h-[55vh] font-mono text-sm"` → actions row: `LoadingButton variant="primary"` Import (disabled when empty), `LoadingButton variant="secondary"` Copy prep, muted version line `ml-auto` → `<details>`-style toggle button labelled `Details` with `detailsHint` beside it when closed; body = `children`. Esc hint rendered top-right in `text-xs text-gray-400` with a `<kbd>`.
- Textarea `onKeyDown`: `Escape` → if `pasteValue.trim() === ''` call `onEscapeEmpty()`, else `(e.target as HTMLTextAreaElement).blur()`; `e.stopPropagation()` in both cases so `useEscapeBack` does not double-fire.

- [ ] **Step 1: Write failing tests** (jsdom; mock nothing from hooks — component is pure):

```tsx
it('renders the three stamps with absolute time and "never" when missing')
it('marks the maker stamp when newerThanPaste is true')
it('Details is collapsed by default, shows the hint, and reveals children on click')
it('Import is disabled when the box is empty and calls onImport when filled')
it('Escape in an empty box calls onEscapeEmpty; in a filled box it blurs and does not')
```

- [ ] **Step 2: Run** `npx vitest run components/builder/__tests__/FerryDesk.test.tsx` → FAIL.

- [ ] **Step 3: Implement** component + copy keys.

- [ ] **Step 4: Run → PASS.** Also `npm run lint`.

- [ ] **Step 5: Commit** — `feat(brief): FerryDesk component (stamps, big paste box, details twiddle)`

---

### Task 4: Wire `BriefTab` to `FerryDesk`

**Files:**
- Modify: `components/builder/BuilderProjectView.tsx:457-760` (`BriefTab`)

**Interfaces:**
- Consumes: `FerryDesk` (Task 3), `ferryStamps` (Task 1), `useUpdateProject` with the new keys (Task 2).

- [ ] **Step 1: Restructure the JSX.** Replace the header row, ferry-controls row, paste `Card`, `BriefEditor`, regen button and Attachments block with:
  ```tsx
  <FerryDesk stamps={ferryStamps(project ?? {})} briefVersion={brief?.version ?? null} sessionCount={briefTabSessions?.length ?? 0} … textareaRef={importTextareaRef}>
    {/* Details body, in this order: */}
    <div className="flex items-center gap-4"> Copy markdown · Update from conversation (uses API) </div>
    <BriefEditor … />
    <Attachments block (unchanged) />
  </FerryDesk>
  ```
  Keep the regen `Modal` outside `FerryDesk`. Keep `importCardRef` pointing at the FerryDesk wrapper so `autoOpenImport` still scrolls there.

- [ ] **Step 2: Stamp on copy.** In `handleCopyPayload`, after `navigator.clipboard.writeText(prompt)` succeeds: `updateProject.mutate({ project_id: projectId, prep_copied_at: new Date().toISOString() })`.

- [ ] **Step 3: Stamp on paste.** In `handleImportJson`, after the brief save and any config PATCH both succeed, PATCH `payload_pasted_at: new Date().toISOString()` (fold it into the existing `updateProject.mutateAsync` call when there is one, else a separate call). Not on failure.

- [ ] **Step 4: Esc.** `onEscapeEmpty={() => router.push('/dashboard')}` (router already in scope in the parent; pass it down or lift). 

- [ ] **Step 5: Verify**: `npm run build && npm run type-check && npm test`. Then `npm run dev`, open a brief as admin, check: stamps render, paste box ≥ half the viewport, Details collapsed, Copy prep writes the stamp (reload shows it), Import of a brief-only JSON writes the paste stamp, Esc from the empty box returns to the dashboard, dispatch-modal "load a payload" link still focuses the box.

- [ ] **Step 6: Commit** — `feat(brief): Brief tab is the ferry desk; stamps written on copy/paste`

---

### Task 5: Dashboard row stamps

**Files:**
- Modify: `app/dashboard/page.tsx:473-489` (activity line in `renderCard`)
- Modify: `lib/copy.ts` (`copy.dashboard`: `prepCopiedAt: (t) => \`Prep copied ${t}\``, `payloadPastedAt: (t) => \`Pasted ${t}\``, `newerThanPaste: 'new since paste'`)

**Interfaces:**
- Consumes: `makerNewerThanPaste` (Task 1).

- [ ] **Step 1: Implement.** In the `text-xs text-gray-400` activity row add, after the maker span: `{project.prep_copied_at && <span>{d.prepCopiedAt(ago(project.prep_copied_at))}</span>}`, `{project.payload_pasted_at && <span>{d.payloadPastedAt(ago(project.payload_pasted_at))}</span>}`. When `makerNewerThanPaste(project)`, render the maker span in `text-brand-navy font-medium` and append a small pill with `d.newerThanPaste`.

- [ ] **Step 2: Verify** in the dev server dashboard: a brief with maker activity and no paste shows the pill; one pasted after the maker's message does not.

- [ ] **Step 3: Commit** — `feat(dashboard): show prep-copied / pasted stamps and new-since-paste marker`

---

### Task 6: Housekeeping

**Files:**
- Modify: `.gitignore` (add `.superpowers/`)
- Modify: `docs/changelog.md` (prepend entry), `CLAUDE.md` Next Steps (one line)

- [ ] **Step 1:** Add `.superpowers/` to `.gitignore`; confirm `git status` no longer lists it.
- [ ] **Step 2:** Changelog entry: date, PR, what changed, the two new fields.
- [ ] **Step 3:** Commit — `chore: ignore .superpowers, changelog for ferry desk`
- [ ] **Step 4:** Open PR `brief-ferry-desk` → `main`, title "Brief tab as a ferry desk (stamps, big paste box, details twiddle)". Push the branch to `preview` only if Nico asks.
