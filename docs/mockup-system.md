# Inline Wireframe Mockup System

## What it does

The agent can show visual layout mockups inline in chat conversations. Instead of describing page structure in text ("first there's a hero section, then an about section..."), the agent renders stacked colored blocks that a non-technical maker can immediately understand and react to.

The builder seeds layout mockups as JSON on a project. The agent presents them during conversation and modifies them based on maker feedback ("move the gallery above the order button" → agent emits an updated wireframe).

## How it works

### Data flow

1. Builder adds mockups via **MockupEditor** (JSON textarea with live preview) on the Next Conversation tab
2. Mockups save to `project.layout_mockups` via PATCH /api/projects
3. When a session is created, mockups snapshot to `session.layout_mockups`
4. Chat API reads mockups from session (or falls back to project) and includes them in the system prompt
5. Agent emits ` ```wireframe\n{...}\n``` ` fenced blocks in its response
6. **MessageContent** parser splits the response into text + wireframe segments
7. **WireframePreview** renders each wireframe as colored labeled rectangles
8. Maker sees visual layouts inline in the conversation, old versions stay in scroll history

### Wireframe JSON format

```json
{
  "title": "Strategy A: Single Page",
  "sections": [
    { "type": "hero", "label": "Welcome to Bakery Louise", "description": "Hero photo grid" },
    { "type": "text", "label": "About", "description": "Micro-bakery story" },
    {
      "type": "cta",
      "label": "Order Upcoming Bakes",
      "description": "Button linking to Simply Bread"
    },
    { "type": "gallery", "label": "Custom Cakes", "description": "Photo portfolio with sizes" },
    {
      "type": "form",
      "label": "Request a Custom Order",
      "description": "Form: item type, date, servings"
    },
    { "type": "signup", "label": "Stay in the Know", "description": "Email list signup" }
  ]
}
```

Multi-page layouts: add `"page": "Home"` to sections to group them under page headings.

### Section types

Each type gets a distinct color and icon so sections are visually distinguishable at a glance:

- **hero** — amber, Image icon
- **text** — blue, AlignLeft
- **cta** — green, MousePointerClick
- **gallery** — purple, LayoutGrid
- **form** — rose, ClipboardList
- **signup** — teal, Mail
- **nav** — gray, Menu
- **footer** — gray, Minus
- **map** — emerald, MapPin
- **video** — indigo, Play
- Unknown types get gray/Box (forward-compatible — agent can invent new types without breaking)

### Key files

- `components/ui/WireframePreview.tsx` — Visual renderer (section type → color/icon mapping)
- `components/ui/MessageContent.tsx` — Parser that splits message content into text and wireframe segments
- `components/ui/__tests__/MessageContent.test.ts` — 9 unit tests for the parser
- `lib/agent/system-prompt.ts` — Teaches the agent the wireframe format
- `lib/agent/next-convo-prompt.ts` and `lib/agent/new-project-prompt.ts` — Both include `layout_mockups` in their JSON output schema
- `lib/types/index.ts` — WireframeMockup and WireframeSection types

### Streaming behavior

During SSE streaming, wireframe blocks arrive character by character. The parser only renders a block once both opening and closing fences are present. While a block is still streaming, the UI shows "Drawing layout..." instead of partial JSON.

### Prep workflow integration

Both prep prompts (`new-project` and `next-convo` — see `lib/agent/new-project-prompt.ts` and `lib/agent/next-convo-prompt.ts` for the full schemas) include `layout_mockups` in their JSON output. When you discuss layout strategies with Claude and ask for the output, the returned JSON includes a `layout_mockups` array. Pasting it back into the matching import field saves mockups alongside the rest of the project setup.

## Potential improvements

### 1. Side panel view

**Problem:** Wireframes scroll away during conversation. The maker has to scroll up to see the layout they're discussing.

**Design:**

- Split the maker chat view into two panes: chat on the left, wireframe panel on the right
- Panel shows the most recent wireframe from the conversation, auto-updating as new ones arrive
- A "pin" button on any inline wireframe sends it to the panel (for comparing older versions)
- Panel collapses to a thin strip with a toggle button on narrow screens (mobile)
- State: track `pinnedWireframe` in the chat component — defaults to latest, overridden by pin clicks

**Files:**

- `components/maker/MakerProjectView.tsx` — layout change from single column to split pane
- New `components/maker/WireframePanel.tsx` — the panel component
- MessageContent needs a callback prop to bubble up "pin this wireframe" clicks

**Complexity:** Medium. Main risk is responsive behavior and making the split feel natural on mobile.

### 2. Structured mockup editor

**Problem:** Builders have to write JSON by hand. Works for Nico but not for Max or future builders.

**Design:**

- Replace JSON textarea with a form-based editor
- "Add section" button opens a row: type dropdown (hero/text/cta/etc with icons), label input, description input, optional page input
- Existing sections shown as a reorderable list (drag handle on the left, or up/down arrow buttons)
- Title field at the top
- Still keep a "Paste JSON" toggle for power users (collapses the form, shows the textarea)
- Editor produces the same `WireframeMockup` object — no data model changes needed
- Live preview stays (WireframePreview below the editor)

**Files:**

- `components/builder/BuilderProjectView.tsx` — replace `MockupEditor` internals
- No backend changes — same `layout_mockups` field, same types

**Complexity:** Medium. Drag-to-reorder is the hardest part — could start with up/down buttons and add drag later. The rest is straightforward form inputs.

### 3. Diff highlighting

**Problem:** When the agent shows an updated wireframe, the maker can't easily see what changed.

**Design:**

- Compare the new wireframe to the previous one in the same conversation
- MessageContent tracks the last-seen wireframe per message list and passes a `previous` prop to WireframePreview
- WireframePreview diff mode:
  - New sections (label not in previous): green left border + "NEW" badge
  - Removed sections (in previous but not current): shown at the bottom as faded/strikethrough with red border
  - Reordered sections (same label, different position): subtle arrow indicator
  - Changed descriptions: highlight the description text
- Matching logic: match sections by `label` (not index) since labels are the stable identifier

**Files:**

- `components/ui/WireframePreview.tsx` — add optional `previousMockup` prop, diff rendering
- `components/ui/MessageContent.tsx` — track previous wireframe and pass it through

**Complexity:** Low-medium. The visual indicators are simple Tailwind. The matching logic (by label) is straightforward. Edge case: maker asks to rename a section — that looks like remove + add, which is fine.

### 4. Export to document

**Problem:** The agreed-upon layout lives in chat history. No way to share it outside the system.

**Design:**

- Add a "Copy as text" button on any WireframePreview — generates a clean text description:
  ```
  Strategy A: Single Page
  ─────────────────────
  [Hero] Welcome to Bakery Louise
    Hero photo grid showing range of offerings
  [Text] About
    Micro-bakery story, Shoreline location
  ...
  ```
- Add a "Save to brief" button — saves the wireframe as a new field on the brief (`layout` or `agreed_layout`), shown on the Brief tab and in the public brief view
- Future: "Download as image" using html2canvas to screenshot the WireframePreview div — but this adds a dependency, so defer

**Files:**

- `components/ui/WireframePreview.tsx` — add action buttons (copy text, save to brief)
- `lib/types/index.ts` — add `layout?: WireframeMockup` to BriefContent
- `app/api/briefs/route.ts` — accept layout field in brief updates
- Brief tab display — render WireframePreview in the brief view

**Complexity:** Low for copy-as-text, medium for save-to-brief (touches the brief data model).

## Suggested build order

1. **Structured mockup editor** — highest friction right now (JSON textarea is painful), no backend changes
2. **Diff highlighting** — small scope, high impact for conversations
3. **Side panel** — bigger layout change, most valuable once wireframes are used regularly
4. **Export to document** — useful but not blocking anything yet

## State management and data architecture

This section describes how wireframe data flows through the system today, and how the four improvements would extend it. The goal is a mental model of where data lives, how it stays consistent, and what tradeoffs we're making.

### How the system works today

There are three layers of state in iBuild4you:

**1. Firestore (source of truth)**

All persistent data lives in Firestore collections. For wireframes specifically:

- `projects/{id}.layout_mockups` — the builder's current set of mockups. Mutable. Updated via PATCH /api/projects.
- `sessions/{id}.layout_mockups` — snapshot of mockups at the time the session was created. Immutable after creation. This means if the builder changes mockups between sessions, old sessions retain their original context.
- `messages/{id}.content` — agent responses stored as plain text strings, including any ` ```wireframe...``` ` blocks. The wireframe JSON lives _inside the message text_, not as a separate field.

Key point: wireframes in chat aren't structured data in Firestore — they're embedded in message text. The frontend parses them out at render time. This is intentional: no schema migration needed, the agent just writes text, and stored messages are a faithful record of what the agent actually said.

**2. React Query cache (server state mirror)**

React Query manages all data fetched from the API. Relevant query keys:

- `['projects']` — project list with enriched data (session counts, timestamps)
- `['project', projectId]` — single project with all fields including `layout_mockups`
- `['sessions', projectId]` — all sessions for a project (each with snapshotted config)
- `['messages', sessionId]` — all messages for a session
- `['brief', projectId]` — latest brief

Cache config: `staleTime: 1 minute`, `gcTime: 10 minutes`, `refetchOnWindowFocus: false`. This means data can be up to 1 minute stale before a refetch triggers. Mutations (updateProject, createSession, etc.) explicitly `invalidateQueries` on related keys so the UI updates immediately after writes.

The cache is the main mechanism for keeping builder and maker views consistent. When the builder saves mockups, `invalidateQueries(['project', id])` fires, and any component using `useProject(id)` refetches.

**3. React component state (ephemeral UI state)**

Local `useState` in components. For wireframes:

- `MockupEditor`: `jsonInput`, `parseError`, `expandedIndex` — editing state that hasn't been saved yet
- `EditableSetup` / `PrepNextSession`: `mockups` state initialized from `project.layout_mockups`, synced via `useEffect` when project data changes. This is "draft" state — the user edits it, then "Save setup" persists it to Firestore via the mutation.
- `MakerChat`: `messages` array in local state, initialized from `useMessages()` but updated in real-time during SSE streaming. This is the only place where local state diverges from Firestore temporarily — during streaming, the last message grows character by character until the stream completes, then React Query cache is invalidated and the saved version replaces it.

### How streaming works with wireframes

This is the trickiest interaction. During SSE streaming:

1. User sends message → optimistically appended to local `messages` state
2. Empty agent message appended to local state
3. SSE chunks arrive → each chunk appends text to the last message in local state
4. `MessageContent` re-renders on every chunk, running `parseMessageContent()` each time
5. Incomplete wireframe blocks (opening fence, no closing fence) are hidden — "Drawing layout..." shown
6. When closing fence arrives, the complete wireframe renders visually
7. Stream ends → React Query invalidates `['messages', sessionId]` → Firestore version replaces local state

The wireframe parser runs on every render during streaming, which sounds expensive but isn't — it's a single regex split on a string that's typically a few hundred characters. No DOM diffing happens for the wireframe until the block is complete.

### Data flow diagram

````
Builder edits mockups
    │
    ▼
MockupEditor (component state)
    │ "Save setup"
    ▼
PATCH /api/projects ──► Firestore projects/{id}.layout_mockups
    │
    │ invalidateQueries
    ▼
React Query cache ──► UI re-renders with new mockups

Builder creates session
    │
    ▼
POST /api/sessions ──► Firestore sessions/{id}.layout_mockups (snapshot)

Maker sends message
    │
    ▼
POST /api/chat
    │ reads session.layout_mockups (or falls back to project)
    │ includes in system prompt
    ▼
Claude streams response (may include ```wireframe blocks)
    │
    │ SSE chunks
    ▼
MakerChat local state (message grows)
    │ on each render
    ▼
MessageContent.parseMessageContent()
    │
    ├─ text segments ──► <p> tags
    ├─ complete wireframe ──► WireframePreview component
    └─ incomplete wireframe ──► "Drawing layout..." indicator

Stream ends
    │
    ▼
Message saved to Firestore ──► invalidateQueries ──► cache updated
````

### How each improvement affects state

**Structured mockup editor**: No state changes. Same `WireframeMockup[]` flows through the same pipeline. The editor produces the same object — just through form inputs instead of JSON textarea. All state stays in the component until save.

**Diff highlighting**: Adds derived state at render time. `MessageContent` would track the previous wireframe across its segment list and pass it to `WireframePreview` as a `previousMockup` prop. This is purely computed — no new Firestore fields, no cache changes. The diff is recalculated on every render, which is fine since it's just comparing two small arrays by label.

**Side panel**: Adds component state to the maker chat layout. A `pinnedWireframe: WireframeMockup | null` in the chat component, defaulting to the latest wireframe from the message list. The pin action is just a setState — no persistence. If the user refreshes, the panel reverts to showing the latest wireframe (which is fine; pinning is a transient preference during a conversation). If we later want pinning to survive refresh, we could store it in `sessionStorage`, but that's premature.

The harder part is extracting wireframes from the message list to determine "latest." The `parseMessageContent` function already does this per-message. The panel would need to scan all rendered messages to find the most recent wireframe — either by walking the messages in reverse and parsing each until finding one, or by having `MessageContent` report wireframes upward via a callback/context.

Two approaches for the upward reporting:

- **Callback prop**: `MessageContent` accepts `onWireframe?: (mockup: WireframeMockup) => void`, called when a wireframe block is parsed. The chat component collects these and tracks the latest. Simple, explicit, but every MessageContent instance calls it on every render.
- **React context**: A `WireframeContext` provider wraps the message list. Each `MessageContent` registers its wireframes. The panel consumes from context. Cleaner separation but more infrastructure.

The callback approach is simpler and fits the existing patterns in this codebase (no context providers anywhere currently).

**Export to document**: Adds a new Firestore field. `briefs/{id}.content.layout` would store the agreed-upon wireframe. This flows through the existing brief pipeline — `useBrief()` already fetches it, `useUpdateBrief()` already saves it. The "Save to brief" button calls `updateBrief.mutateAsync({ project_id, content: { ...existingBrief, layout: mockup } })`. React Query invalidation handles the rest.

The "Copy as text" export is pure client-side — just string formatting from a `WireframeMockup` object, then `navigator.clipboard.writeText()`. No state changes.

### Things to watch as complexity grows

- **BuilderProjectView is 1400+ lines.** The MockupEditor and any structured editor add more. Consider extracting components into separate files when the time is right.
- **Message parsing on every render.** Currently fine because messages are short and the regex is cheap. If conversations get very long (hundreds of messages), we could memoize `parseMessageContent` per message ID+content. But don't optimize until there's a measured problem.
- **No real-time sync.** The builder and maker see different views and don't share a live connection. If the builder saves mockups while the maker is chatting, the maker won't see them until the next API call (staleTime: 1 min) or page refresh. This is fine for the current use case — the builder sets up before the conversation starts. but when they work together down the road, we'll need to sync well.
- **Wireframe data in message text vs. structured field.** The current approach (embedded in text) is simpler and preserves exactly what the agent said. The tradeoff: you can't query Firestore for "messages containing wireframes" or index them. If we later need that (e.g., "show me all wireframes across all sessions"), we'd add a `has_wireframe: boolean` field to messages, set server-side when saving. But we don't need that yet.
