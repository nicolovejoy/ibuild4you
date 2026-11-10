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

## Decision (Nico, 2026-11-09)

- **Variant A**: the static split view at conversation 4 (brief v7 → v8), with the layout, type (Montserrat headings, Open Sans body) and component shapes exactly as mocked. B1, B2 and the theme feels (paper, press, warm on `?theme=`) are dropped. C (real Tideline turns) stays parked under "Later".
- **Palette 3, "Ivory and indigo"**: background `#fbf8f1`, blue `#283673`, black `#24211d`. In the mock, the secondary shades were mixed from the blue: muted text `color-mix(in oklab, #283673 72%, #8a9099)`, hover `color-mix(in oklab, #283673 85%, white)`, the maker-tag tint `color-mix(in oklab, #283673 10%, white)`. Resolve each to a fixed hex at build time and check AA contrast (muted text on `#fbf8f1` and white must reach 4.5:1).
- Mocks for reference until the build ships: `https://preview.ibuild4you.com/mocks/home/a` and `https://preview.ibuild4you.com/mocks/home/palettes` (branch `mocks/home-page`, commits c7def75, 2a6048f, 9363f5f).

## Build plan (next session)

1. **Branch from main** (`feat/home-page-a`), not from `mocks/home-page`. Bring over only what A needs: `lib/public/hero-script.ts` + its test, the `home` block of `lib/copy-public.ts` (EN + FR), `HeroChat`, `HeroBrief`, `HomeShell` (header with Sign in as a corner link, interest form at the bottom) and A's layout. Leave behind B1/B2, `useHeroPlayer`, the theme tokens (`hero-themes.css`, `themes.ts`), `PaletteSamples`, the mock fonts and every `app/mocks` route.
2. **Colours, an open question for Nico**: palette 3 on the signed-out pages only, or site-wide by changing the `--brand-*` tokens in `app/globals.css` (the dashboard and maker chat use the same navy, cream and charcoal)? Default if not answered: signed-out pages only, through new public tokens, so the signed-in app doesn't change by accident.
3. **Wire it in**: `/` and `/fr` render A in place of `components/public/landing-page.tsx`'s hero; keep the signed-in redirect to `/dashboard`; keep `InterestForm` and restyle it to the palette. "Tell us your idea" and the demo's composer both scroll to the form and focus its first input.
4. **Tests first** (vitest + RTL): the CTA and the composer call the scroll and focus the first input; the phone fold toggles the conversation (`aria-expanded`); FR renders every A string (no English leaking through); the signed-in redirect still fires.
5. **Quality floor**: no horizontal scroll at 375px, visible focus, AA contrast for the palette, and no change to the OG preview copy.
6. **Ship**: PR, CI green, `npm run build` + `npm run type-check`; push to preview and screenshot `/` and `/fr` at 1280 and 390 headless; merge; delete `mocks/home-page` (local and remote); reply on the selected-projects handoff that the page is live.

## Later (not this pass)

Shipped-work grid below the hero: wait for five or six projects with client approval. It needs a public, cached, counts-only endpoint (no names or brief contents, the same rule as link previews). Danny's L6 quote: ask Nico for the final approved text; don't copy a draft.
