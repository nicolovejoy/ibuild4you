# Mode system — viewer-relationship signaling

Status: **design agreed, not built** (2026-06-20). Concept locked; glyph theme + chrome depth still open. Companion to the per-brief role model in `users-and-roles-concept.md` and the visual identity in `lib/brief-identity.ts`.

## Why

On the dashboard, every card badges the viewer as **Reviewer**. This is not a bug: `defaultBriefRole('owner')` returns `null`, so `viewerBriefRole()` (`lib/roles/display.ts`) falls through to `'reviewer'`. The owner/admin of every brief they can see therefore resolves to the same role on all of them — the badge is encoding the viewer's **access tier**, which is invariant for that viewer, so it carries no signal. (A Contributor logging in *would* see a differentiated badge; the gap is specific to the operator-of-everything.)

More fundamentally: roles are **per-brief, not per-user** (see `app/projects/[id]/page.tsx:54` — the view is chosen per brief by access tier). The same human is Originator on one brief, Reviewer on another. The dashboard is the single shared landing for all of them. So a viewer needs to tell, at a glance per card, **what their relationship to this brief is** — and a text badge that says "Reviewer" everywhere doesn't do that.

## Core principle: two orthogonal channels

Per card / per brief, two independent things must be legible. Keep them on **separate visual channels** — never collapse one onto the other.

1. **Identity — "which brief"**: deterministic color + 4-char code + glyph from `briefIdentity(docId)` (`lib/brief-identity.ts`, rendered by `components/ui/BriefBadge.tsx`). **Viewer-independent and constant** — the same brief looks the same to everyone, including on the unauthenticated OG link-preview (`app/projects/[id]/opengraph-image.tsx`). This channel must stay viewer-agnostic.
2. **Mode — "my relationship to this brief"**: per-viewer. Talk here vs operate here vs (future modes). This is the **new** channel.

The rejected shortcut — driving card background color or a hatch pattern from role — collapses #2 onto #1's channel: you could no longer tell "blue because it's the Cafe brief" from "blue because I'm the maker." Hatch additionally reads as *disabled/loading*, resists accessible labeling (texture ≠ semantics for screen readers / colorblind viewers), and doesn't extend to a third state. **Mode gets its own channel: a glyph (+ aria-label), not a recolor.**

## The Mode concept (extensible — N modes, not two)

Today there are two relationships (conversation, console), but the model must accommodate more later (e.g. observer, approver, apprentice/learning, automation/agent). So mode is a **registry**, not a boolean.

A mode entry (proposed shape — final names TBD at build):

```
interface Mode {
  key: ModeKey                 // 'conversation' | 'console' | …future
  label: string                // user-facing, e.g. 'Conversation' / 'Console'
  glyph: GlyphRef              // emoji in-app; Satori-safe SVG if it ever hits the OG card
  ariaLabel: string           // never color/shape-only
  // chrome treatment for the per-brief view rendered in this mode:
  accent: string              // palette token / theme key
}
```

Resolution is a pure function, analogous to `viewerBriefRole`:

```
resolveMode(accessTier, briefRole) -> ModeKey
```

Initial mapping (mirrors the existing view split at `app/projects/[id]/page.tsx:54`):

- access tier `maker` / `apprentice`, or brief role `originator` / `contributor` → **conversation** (you talk to Sam here)
- access tier `owner` / `builder` / `admin`, or brief role `reviewer` → **console** (you operate the brief here)

Keep `resolveMode` the single source of truth so the dashboard card, the brief-view chrome, and the brief-switcher all agree. Add future modes by appending a registry entry + a mapping branch — no caller changes.

### Future mode candidates (not built — recorded so the registry shape anticipates them)

- **observer** — read-only watcher (stakeholder who sees but doesn't act)
- **approver** — sign-off gate (distinct from reviewer's ongoing operation)
- **apprentice / learning** — the `apprentice` access tier may warrant its own mode rather than folding into conversation
- **automation / agent** — when a non-human actor (Loop, a scheduled agent) acts on a brief

## Glyph system

Each mode owns one glyph. The earlier exploration produced ~20 themed *pairs*; under the registry model a pair is just the first two entries of a **family** the future modes also draw from — so pick a theme with **headroom**, not a one-off cute pair.

Shortlist that survives 16px legibility + cross-platform rendering + room to grow:

- **Architect family (recommended)** — conversation 💡 / console 📐; extends cleanly: observer 👓, approver ✅, automation ⚙️/🤖. Reads as "idea-person vs maker" without a caption.
- **Coffee/utility** — ☕ / ⚙️; legible and renders everywhere but doesn't obviously extend to more modes.
- **Cartography** — 🧭 / 🗺️; explorer vs mapmaker; some headroom (🔦 observer).

Constraints any final pick must satisfy:

- **Cross-platform + Satori.** Profession/skin-tone emoji (👷 🧑‍🌾 👨‍🍳) render inconsistently and break in Satori (the OG renderer). The identity system already uses Satori-safe inline SVG for this reason. If a mode glyph ever appears on the OG card, it must be SVG too — so prefer glyphs that have (or can get) a clean SVG form. In-app only, emoji is fine.
- **16px silhouette.** At badge size, silhouette beats detail. 💡/📐, ☕/⚙️, 🧭/🗺️ stay distinct tiny; 🎤/🎚️ and 🪵/🪚 blur.
- **a11y.** Glyph always paired with an `aria-label` (the mode `label`); never the sole carrier of meaning.

## Where modes surface

1. **Dashboard card** (`app/dashboard/page.tsx`): mode glyph next to the existing identity `BriefBadge`. Identity = which brief; glyph = what you do here. The text role badge can stay or be demoted — the glyph does the at-a-glance work. (Fixes the "Reviewer everywhere" non-signal for owner/admin.)
2. **Brief view chrome** (`components/maker/MakerProjectView.tsx`, `components/builder/BuilderProjectView.tsx`): the mode drives **dramatically distinct chrome** so it's unmistakable on entry. These are already entirely separate sibling components with no shared in-brief chrome (`app/layout.tsx` is bare), so divergence has near-zero blast radius and cannot leak across modes.
   - **conversation** → immersive, darker, chat-focused, minimal chrome ("you're here to talk")
   - **console** → light, dense, sidebar + panels ("you're here to operate")
   - future modes → their own treatment from the registry
3. **Brief switcher** (`components/brief-switcher.tsx`): show the mode glyph per entry so switching briefs previews the mode you'll land in.

The one component that crosses the boundary: `components/user-menu.tsx` (`UserMenu`) renders inside both views and the dashboard. Darkening the conversation chrome means `UserMenu` needs a variant (or styling that works on dark + light) — the single real coupling to handle.

## Phasing

- **P1 — registry + resolution + dashboard glyph** (low risk, isolated): add the mode registry + `resolveMode`, render the mode glyph on dashboard cards and the brief-switcher. No chrome changes. Ships the at-a-glance signal immediately.
- **P2 — chrome divergence**: give the conversation view its distinct (darker, immersive) treatment; add the `UserMenu` variant. Console view stays light. Per-brief, isolated to the maker component tree.
- **P3 — OG/SVG glyphs + future modes**: Satori-safe SVG glyphs if modes reach the OG card; add observer/approver/etc. as the product grows.

## Open decisions

1. Glyph theme/family (recommend architect 💡/📐 for headroom — confirm).
2. How dark / how dramatic the conversation chrome goes.
3. Whether the text role badge stays alongside the glyph or the glyph replaces it.
4. Whether `apprentice` gets its own mode now or folds into conversation.

## Anchors

- Role model: `lib/types/index.ts` (`MemberRole`, `BriefRole`), `lib/roles/brief-role.ts` (`defaultBriefRole`), `lib/roles/display.ts` (`viewerBriefRole`)
- View split: `app/projects/[id]/page.tsx:54`
- Identity (don't overload): `lib/brief-identity.ts`, `components/ui/BriefBadge.tsx`, `app/projects/[id]/opengraph-image.tsx`
- Surfaces: `app/dashboard/page.tsx`, `components/maker/MakerProjectView.tsx`, `components/builder/BuilderProjectView.tsx`, `components/brief-switcher.tsx`, `components/user-menu.tsx`
- Vocab: `lib/copy.ts` glossary (`originator`/`contributor`/`reviewer`)
