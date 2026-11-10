# Home page A: build (SDD plan)

Spec: `docs/superpowers/plans/2026-11-09-home-page-mocks.md`, sections "Decision (Nico, 2026-11-09)" and "Build plan". That doc is the authority; this file splits its build plan into tasks.

Branch: `feat/home-page-a`, cut from main. The mock code lives on branch `mocks/home-page` and is read with `git show mocks/home-page:<path>`. Reference render: `https://preview.ibuild4you.com/mocks/home/a` (layout) and `https://preview.ibuild4you.com/mocks/home/palettes` (row "3 · Ivory and indigo").

## Global Constraints

- Variant A exactly as mocked: layout, type (Montserrat headings, Open Sans body, the fonts already loaded by the app), component shapes. Nothing from B1, B2, the `?theme=` feels (paper, press, warm), `useHeroPlayer`, `PaletteSamples`, `app/mocks/home/fonts.ts` (Geist, Newsreader) or any `app/mocks` route comes over.
- Palette 3, "Ivory and indigo": background `#fbf8f1`, blue `#283673`, black `#24211d`. Derived shades as mocked, resolved to fixed hex at build time: muted text = `color-mix(in oklab, #283673 72%, #8a9099)`, hover = `color-mix(in oklab, #283673 85%, white)`, maker-tag tint = `color-mix(in oklab, #283673 10%, white)`. Muted text must reach 4.5:1 contrast on both `#fbf8f1` and `#ffffff`; if the resolved mix falls short, darken it the minimum needed and say so in the report.
- Ruling (palette scope): signed-out home pages only (`/`, `/fr`), through tokens scoped to the home page's root element. `app/globals.css` `--brand-*` tokens are not touched, so the signed-in app does not change.
- Every reader-facing string lives in `lib/copy-public.ts` with its French twin (glossary `/Users/nico/src/prompt-lab/workflow/localization/fr-glossary.md`). No inline strings in components.
- Keep: the signed-in redirect to `/dashboard`, `usePublicPageLocale`, the existing `InterestForm` behaviour (`/api/interest`), the OG/link-preview copy and `app/fr/opengraph-image.tsx` unchanged.
- Quality floor: no horizontal scroll at 375px, visible focus on every control, no layout shift.
- Code style: clarity over cleverness, comments where non-obvious (repo CLAUDE.md).
- Verification in this worktree: `npm test`, `npm run lint`, then `npm run build` with dummy Firebase env exported (`NEXT_PUBLIC_FIREBASE_API_KEY=dummy NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=dummy.firebaseapp.com NEXT_PUBLIC_FIREBASE_PROJECT_ID=dummy NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=dummy NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1 NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:1`), then `npm run type-check`. Both build and type-check are required (CLAUDE.md gotcha). Never commit `lib/build-info.json`.
- Tests: vitest, default environment `node`; component tests opt into jsdom with a `// @vitest-environment jsdom` first-line comment. `@testing-library/react` is installed.

## Task 1: Port the demo pieces and the palette

Bring over, from `mocks/home-page`, only what variant A needs:

- `lib/public/hero-script.ts` and `lib/__tests__/hero-script.test.ts`. Keep only the `later` script (conversation 4, brief v7 → v8) and the helpers A uses; drop the `intro` script and any helper used only by B1/B2 playback (and its tests). If `HeroBrief`'s props need `revealedIds`, keep it.
- The `home` block of `lib/copy-public.ts` (EN and FR), trimmed to the strings A, the shell and the interest section use. Drop B-only strings (replay, the intro caption, the intro script).
- `components/public/hero/HeroChat.tsx` and `HeroBrief.tsx`, unchanged except removing props/branches only B used (typing indicator, highlight of just-changed lines) if that removal is clean; otherwise leave them as they are.
- A home stylesheet `components/public/hero/home.css` replacing `hero-themes.css`: the structural rules (`.hero-window`, `.hero-btn`, `.hero-bubble`, `.hero-badge`, `.hero-dots`, `.hero-header`, heading/body fonts) scoped to `[data-home]`, with the token values of the mock's `today` theme plus the palette-3 overrides from `PaletteSamples.vars()`, resolved to fixed hex. Same `--h-*` token names so HeroChat/HeroBrief work unchanged.
- `lib/public/home-palette.ts`: the resolved palette as named hex constants (bg, blue, black, muted, hover, ownerTint) and a small `contrastRatio(hexA, hexB)` helper (WCAG relative luminance). Test `lib/__tests__/home-palette.test.ts`: muted on bg ≥ 4.5, muted on white ≥ 4.5, black on bg ≥ 4.5, white on blue ≥ 4.5, and a comment-free check that the CSS file's values match the constants (read `home.css` as text and assert each constant appears).

No page uses these yet. Commit.

## Task 2: The home page, wired into `/` and `/fr` (tests first)

- `components/public/home-page.tsx` (client): `HomePage({ locale })` = the auth handling moved from `LandingPage` (loading state, redirect to `/dashboard` when signed in, render nothing for a user, `usePublicPageLocale(locale, locale === 'en' ? '/fr' : '/')`) wrapping a `HomeShell` and variant A's body (`Headline`, `Window`, desktop split, phone fold) ported from `mocks/home-page:components/public/hero/variants.tsx` and `HomeShell.tsx`. HomeShell drops `mockLabel`, `theme`, `fontClassName`; its root carries `data-home`, imports `home.css`.
- Move `InterestForm` out of `components/public/landing-page.tsx` into `components/public/interest-form.tsx`, same behaviour, restyled to the palette tokens (inputs, button, focus ring). The form's first input is what the scroll focuses.
- `app/page.tsx` and `app/fr/page.tsx` render `HomePage`. Delete `components/public/landing-page.tsx` and any copy keys only it used, once nothing imports them (grep first; the about page and OG image may share keys).
- Tests first, `components/public/__tests__/home-page.test.tsx` (jsdom), mocking `useAuth` and `next/navigation`:
  1. "Tell us your idea" click calls `scrollIntoView` on the `#interest` section and focuses its first input (stub `scrollIntoView` and `matchMedia`, use fake timers).
  2. The demo composer click does the same.
  3. The phone fold button toggles `aria-expanded` false → true and shows the conversation.
  4. FR: rendering `locale="fr"` contains none of the English A strings (compare against `publicCopy.en.home` values that differ from FR).
  5. Signed in: `router.push('/dashboard')` is called and nothing renders.
Commit.

## Task 3: Docs

- Prepend an entry to `docs/changelog.md` (house style: read the top entries) for the new signed-out home page.
- In `CLAUDE.md` Next Steps → Queue, replace the home-page paragraph with one line: home page A built on `feat/home-page-a`, awaiting preview check and merge; then delete `mocks/home-page`.
- In the spec doc, mark build-plan item 2 answered by the ruling (signed-out pages only).
Commit.
