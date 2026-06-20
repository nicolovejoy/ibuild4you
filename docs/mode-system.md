# Mode system — viewer-relationship signaling

Status: **design agreed, not built** (2026-06-20). Concept + glyph family + chrome naming locked; chrome depth (how dark) still open. Companion to the per-brief role model in `users-and-roles-concept.md` and the visual identity in `lib/brief-identity.ts`.

## Why

On the dashboard, every card badges the viewer as **Reviewer**. Not a bug: `defaultBriefRole('owner')` returns `null`, so `viewerBriefRole()` (`lib/roles/display.ts`) falls through to `'reviewer'`. The owner/admin of every brief they can see resolves to the same role on all of them — the badge encodes the viewer's **access tier**, which is invariant for that viewer, so it carries no signal. (A Contributor logging in *would* see differentiated badges; the gap is specific to the operator-of-everything.)

More fundamentally: roles are **per-brief, not per-user** (`app/projects/[id]/page.tsx:54` chooses the view per brief by access tier). The same human is Originator on one brief, Reviewer on another. The dashboard is the single shared landing for all of them. So a viewer needs to tell, at a glance per card, **what their relationship to this brief is** — and a text badge that says "Reviewer" everywhere doesn't do that.

## Core principle: two orthogonal channels

Per card / per brief, two independent things must be legible. Keep them on **separate visual channels** — never collapse one onto the other.

1. **Identity — "which brief"**: deterministic color + 4-char code + glyph from `briefIdentity(docId)` (`lib/brief-identity.ts`, rendered by `components/ui/BriefBadge.tsx`). **Viewer-independent and constant** — the same brief looks the same to everyone, including on the unauthenticated OG link-preview (`app/projects/[id]/opengraph-image.tsx`). Must stay viewer-agnostic.
2. **Mode — "my relationship to this brief"**: per-viewer. This is the **new** channel.

The rejected shortcut — driving card background color or a hatch pattern from role — collapses #2 onto #1's channel: you could no longer tell "blue because it's the Cafe brief" from "blue because I'm the maker." Hatch additionally reads as *disabled/loading*, resists accessible labeling (texture ≠ semantics for screen readers / colorblind viewers), and doesn't extend to more states. **Mode gets its own channel: a glyph (+ aria-label), not a recolor.**

## The model: two granularities, both derived from role

The mode channel operates at **two resolutions**, both computed from the viewer's per-brief role. This is the key structural decision (replaces an earlier "A-vs-B pair" framing):

### 1. Role glyph — fine-grained, one glyph per role, a *set*

Not a binary pair. Each **brief role** gets its own glyph, all drawn from **one thematic family** so the set reads as a coherent system and new roles slot in naturally. This is the "several different ones" — it scales to N roles. Shows on the **dashboard card, brief switcher**, and brief headers.

Today's three roles are the user-facing RAAC vocab (`lib/copy.ts` glossary, `lib/roles/display.ts`): **Originator / Contributor / Reviewer**. Future roles (observer, approver, apprentice-as-own-role, automation/agent) each get their own glyph from the same family.

### 2. Chrome mode — coarse, two treatments, derived from role

The per-brief **view** needs only two chrome treatments. The distinction is **posture: participant vs operator** — "am I a voice in this, or am I running it?"

- **Conversation** (participant) — you're a voice in the room. Whole screen is chat with Sam, your bubbles, the brief card as reference. No knobs. (`MakerProjectView`.) Roles: **Originator, Contributor**.
- **Console** (operator) — you're running the brief: sessions list, the "next round"/dispatch card, agent setup (directives/seed questions/reminders/model/repo), brief editing (structured-JSON document), People (invite/roles), Files. The console is a **superset** — it can also read the conversation; the participant view cannot reach the controls. (`BuilderProjectView`.) Roles: **Reviewer** (and owner/builder/admin access tiers).

"Console" is deliberate: it's already the codebase word for the builder surface, and it fits the studio metaphor below (the Reviewer is at the mixing board / in the booth; performers are on stage). The chrome may not even need a *visible* label — the dark/light divergence + the role glyph carry the meaning; "Console" is the internal name for the treatment.

So: **glyph = one-per-role (the set); chrome = the coarse participant/operator split.** Both fall out of the role. `resolveMode(role) → 'conversation' | 'console'` gives the chrome; the role itself selects the glyph.

## Glyph family: studio / production (locked)

Metaphor: everyone's making a record together — performers on stage, the reviewer in the booth. Honors the "mic vs tools" direction and, crucially, is a genuine *family* so the set scales.

- **Originator** 🎤 — brought the idea, the lead voice
- **Contributor** 🎸 — joins in, adds their part
- **Reviewer** 🎛️ — at the board, shapes and operates
- *(future)* **Observer** 🎧 — listening in, read-only
- *(future)* **Approver** 🎬 — calls the take done

Chrome split maps cleanly: 🎤 + 🎸 = on stage → **conversation**; 🎛️ = the booth → **console**.

Alternate families considered (recorded, not chosen): **architect** (💡/✏️/📐/👓/✅ — cleanest SVG path if needed) and **coffee** (liked, but weak headroom past 2 glyphs — keep coffee for flavor elsewhere, not the role system).

Constraints any glyph must satisfy:
- **16px silhouette** — distinct when tiny. The studio set passes (vertical mic / angular guitar / grid board / headphones / clapperboard).
- **Cross-platform + Satori** — profession/skin-tone emoji render inconsistently and break in Satori (the OG renderer). The identity system already uses Satori-safe inline SVG. If a glyph ever appears on the OG card it must be SVG too; in-app, emoji is fine.
- **a11y** — glyph always paired with an `aria-label` (the role label); never the sole carrier of meaning.

## Implementation shape

A role→glyph map plus a `resolveMode` for the chrome (analogous to `viewerBriefRole`):

```
// role glyph (the set)
ROLE_GLYPHS: Record<BriefRole | FutureRole, GlyphRef>

// chrome (the coarse split) — single source of truth, all surfaces agree
resolveMode(role): 'conversation' | 'console'
  originator | contributor          -> 'conversation'
  reviewer (+ owner/builder/admin)  -> 'console'
```

Adding a role later = one `ROLE_GLYPHS` entry + (if it needs distinct chrome) one `resolveMode` branch. No caller changes.

## Where it surfaces

1. **Dashboard card** (`app/dashboard/page.tsx`): role glyph next to the identity `BriefBadge`. Identity = which brief; glyph = your role here. The text role badge can be demoted/dropped — the glyph does the at-a-glance work. (Fixes "Reviewer everywhere" for owner/admin.)
2. **Brief view chrome** (`components/maker/MakerProjectView.tsx`, `components/builder/BuilderProjectView.tsx`): `resolveMode` drives **dramatically distinct chrome** — conversation = immersive/darker/minimal ("you're here to talk"); console = light/dense/sidebar ("you're here to run it"). These are already entirely separate sibling components with no shared in-brief chrome (`app/layout.tsx` is bare), so divergence has near-zero blast radius and cannot leak across modes.
3. **Brief switcher** (`components/brief-switcher.tsx`): role glyph per entry, so switching previews your role on each brief.

The one component that crosses the boundary: `components/user-menu.tsx` (`UserMenu`) renders inside both views and the dashboard. Darkening the conversation chrome means `UserMenu` needs a variant (or styling that works on dark + light) — the single real coupling.

## Phasing

- **P1 — role-glyph map + `resolveMode` + dashboard glyph** (low risk, isolated): add the map + resolver, render the role glyph on dashboard cards and the brief switcher. No chrome changes. Ships the at-a-glance signal immediately and fixes "Reviewer everywhere."
- **P2 — chrome divergence**: give conversation its distinct (darker, immersive) treatment; add the `UserMenu` variant. Console stays light. Per-brief, isolated to the maker component tree.
- **P3 — OG/SVG glyphs + future roles**: Satori-safe SVG glyphs if they reach the OG card; add observer/approver/etc. as the product grows.

## Open decisions

1. ~~Glyph family~~ → **studio (locked)**.
2. ~~Operator chrome name~~ → **Console (locked)**; visible label TBD (may be unlabeled).
3. How dark / how dramatic the conversation chrome goes (P2).
4. Whether the text role badge stays alongside the glyph or the glyph replaces it (lean: glyph replaces on cards).
5. Whether `apprentice` access tier gets its own role/glyph now or folds into Contributor/conversation.

## Anchors

- Role model: `lib/types/index.ts` (`MemberRole`, `BriefRole`), `lib/roles/brief-role.ts` (`defaultBriefRole`), `lib/roles/display.ts` (`viewerBriefRole`)
- View split: `app/projects/[id]/page.tsx:54`
- Identity (don't overload): `lib/brief-identity.ts`, `components/ui/BriefBadge.tsx`, `app/projects/[id]/opengraph-image.tsx`
- Surfaces: `app/dashboard/page.tsx`, `components/maker/MakerProjectView.tsx`, `components/builder/BuilderProjectView.tsx`, `components/brief-switcher.tsx`, `components/user-menu.tsx`
- Vocab: `lib/copy.ts` glossary (`originator`/`contributor`/`reviewer`)

## Related: session cost estimate (shipped same session, PR #88)

Orthogonal but bundled in the same PR branch: per-session list-price cost estimate (`token_cost_usd`) shown next to the token count. Computed from full usage (incl. cache tokens) via `lib/observability/session-cost.ts` so it stays accurate despite the displayed token totals being the uncached remainder. Not part of the mode system; noted here only because it shares PR #88.
