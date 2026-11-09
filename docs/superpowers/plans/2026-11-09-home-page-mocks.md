# Signed-out home page: mocks, then build (rough plan)

Request: selected-projects handoff 2026-11-06 (`~/src/.handoff/selected-projects-ibuild4you.md`); this is Nico's ask. Acknowledged 2026-11-09 with the approach below. Nico approved: mocks as preview routes, hero first (grid later), "Tell us your idea" goes to the existing interest form.

## Goal

Replace the current page (`components/public/landing-page.tsx`, used by `/` and `/fr`) with one that shows the product working, not a description of it. The main button is "Tell us your idea", which scrolls to the existing `InterestForm` (`/api/interest`); Sign in becomes a small corner link next to `LangSwitch`. Keep the signed-in redirect to `/dashboard`.

## Mocks (one branch, pushed to preview.ibuild4you.com)

Routes under `app/mocks/home/<variant>/page.tsx`, each rendering a full candidate page. Preview sits behind the Vercel login gate, so nothing here is public. Add `robots: noindex` and do not merge the `mocks` routes to main. Only the chosen variant gets merged, in place of `landing-page.tsx`.

1. **A: static split view.** Made-up project. Left: four to six turns with Sam. Right: the brief they produced: summary, two or three decisions with provenance ("conv 2 · Jul 11, revised conv 4"), an open-questions card with the owner of each risk, and a "brief v7 → v8" marker. On a phone: brief card first, chat folded under it.
2. **B1: animated, side by side.** Household-chores assistant (descale the kettle, change the furnace filter, flip the mattress). A 20 to 30 s loop: each maker message makes a brief line appear or light up as updated. Reduced motion shows the final still frame. One orchestrated motion, nothing else animates.
3. **B2: animated, single column.** The same script, with the chat and the brief stacked in one narrow device-like column. It's the phone-first take, and it may also read better on desktop.
4. **C: Tideline, distilled (gated).** The same engine as B, run on a handful of real Tideline intake turns. Needs the conversation text: Nico pulls it read-only with `scripts/inspect-project.mjs` (the secrets hook blocks the agent from that command). Private review only. It goes public only after the Tideline maker sees the draft and agrees. Don't route it through the tideline handoff channel (that correction was 2026-10-29).

Expected recommendation (confirm on screenshots): B1 or B2 as the hero, with A as the still frame and the reduced-motion fallback. C goes below the hero once cleared.

## How to build

- **One data shape, one script.** A `HeroScript` fixture: turns plus, for each turn, which brief lines appear or update. Variants A, B1, B2 and C differ only in layout and in whether the script plays. Put it in `lib/public/hero-script.ts`.
- **Reuse real pieces, presentationally.**
  - `lib/builder/decision-provenance.ts` (the provenance label).
  - `components/ui/MessageContent.tsx`.
  - `components/builder/OpenQuestionsCard.tsx`. It takes `questions: string[]` and has a copy button; a mock may need an owner-aware, copy-less variant. Extract one rather than fork it.
  - The maker brief card lives inline in `MakerProjectView.tsx`. Extract a props-only `BriefView` if the mock needs it, and keep the maker view using it, so the mock can't drift from the product.
- **Copy.** Every string, including each scripted line of the conversation and the brief, goes in `lib/copy-public.ts` with its French twin (glossary: `prompt-lab/workflow/localization/fr-glossary.md`). Check the `/fr` page renders each variant.
- **Brand.** Existing tokens (`brand-navy`, `brand-cream`, `brand-slate`, `brand-charcoal`; Montserrat headings, Open Sans body, in `app/globals.css`). Run the frontend-design pass inside the brand, not a new identity.
- **Quality floor.** No horizontal scroll at 375px, visible focus, `prefers-reduced-motion`, and no layout shift while the loop plays (reserve the brief's final height).
- **Review.** Headless Playwright screenshots of each variant at 1280 and 390, light mode, against preview with the bypass cookie (`scripts/lib/preview-login.mjs` has the bypass handling; signed-out pages need no login). Look at them before recommending.

## Deliver

Reply on the selected-projects handoff with the four preview URLs, the screenshots, and one recommendation. Nico picks; then build the chosen one on a feature branch with tests for the "Tell us your idea" scroll and the reduced-motion still, ship it via PR and preview, and delete the mock routes.

## Later (not this pass)

Shipped-work grid below the hero: wait for five or six projects with client approval. It needs a public, cached, counts-only endpoint (no names or brief contents, the same rule as link previews). Danny's L6 quote: ask Nico for the final approved text; don't copy a draft.
