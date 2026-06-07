# Preview Firestore Split — Runbook

Give preview deployments their own Firebase project so preview writes land in a
sandboxed DB instead of overwriting production. Closes the May 23 footgun (a
real maker's `requester_email` got overwritten from a preview write) and
unblocks agent-driven Playwright on `preview.ibuild4you.com`.

## Key insight: env-var scoping + one code fix

Both Firebase SDKs read entirely from environment variables:

- Admin SDK (`lib/firebase/admin.ts`) — `FIREBASE_SERVICE_ACCOUNT` (JSON blob)
- Client SDK (`lib/firebase/client.ts`) — `NEXT_PUBLIC_FIREBASE_API_KEY`,
  `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
  `NEXT_PUBLIC_FIREBASE_APP_ID`

So the split is mostly **env-var scoping + Firebase/Vercel console work**: stand
up a second Firebase project, then point Vercel's *Preview* environment at it.

⚠️ **One code fix was required** (an earlier draft of this doc claimed none):
`next.config.ts` rewrote `/__/auth/*` to a **hardcoded prod** `firebaseapp.com`,
which would route preview's Google sign-in handshake through the prod project
even with every env var flipped. Now derives the destination from
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` (defaults to prod — a no-op on prod). Done.

Rules + indexes are version-controlled (`firebase.json` → `firestore.rules`,
`firestore.indexes.json`), so "copy rules + indexes to preview" is one
`firebase deploy --project preview` — no manual console copy.

## Ownership legend

- 🤖 agent-doable in-repo (no secrets, no consoles)
- 👤 Nico — Firebase/Vercel console or secret handling (the secrets hook blocks the agent here)

---

## Phase 1 — repo groundwork 🤖 — DONE

- `.firebaserc` added with project aliases: `default`/`prod` = `ibuild4you-a0c4d`,
  `preview` = `ibuild4you-preview` (placeholder ID — confirm/replace once the
  project exists).
- This runbook.

⚠️ `default` is pinned to **prod**, matching current implicit behavior — a bare
`firebase deploy` still targets prod. Always pass `--project preview` for the
sandbox.

## Phase 2 — create the preview Firebase project — MOSTLY DONE (2026-06-06)

DONE via CLI (firebase + gcloud, authed as nlovejoy@me.com):
- Project `ibuild4you-preview` created; `.firebaserc` alias confirmed real.
- Firestore API enabled (gcloud); `(default)` DB created, `nam5` multi-region.
- Web app registered. Public config (non-secret):
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` = `ibuild4you-preview`
  - `NEXT_PUBLIC_FIREBASE_API_KEY` = `AIzaSyALL49WWM1tOqsvvaaEmr8gg_LqqEdeSiU`
  - `NEXT_PUBLIC_FIREBASE_APP_ID` = `1:149838762833:web:2938264c76e7965fad3970`
  - project number `149838762833`

STILL 👤 (secret — needs your hands):
- Project settings → Service accounts → **Generate new private key** → this JSON
  becomes `FIREBASE_SERVICE_ACCOUNT`. Store in 1Password `dev-secrets`
  (e.g. `op://dev-secrets/ibuild4you-preview-sa`).
  https://console.firebase.google.com/project/ibuild4you-preview/settings/serviceaccounts/adminsdk

## Phase 3 — auth setup 👤

1. Authentication → Sign-in method → enable **Google**.
2. Authentication → Settings → **Authorized domains**: add
   `preview.ibuild4you.com` and `localhost`.
3. Google OAuth: the Firebase-managed OAuth client needs
   `preview.ibuild4you.com` as an authorized redirect origin. (Client SDK uses
   `authDomain` = the app's own domain for same-origin auth — see the comment in
   `lib/firebase/client.ts` — so `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` should be
   `preview.ibuild4you.com` on the Preview env.)
4. Passcode auth needs no provider — it's app-level (mints a custom token via
   the Admin SDK against `project_members.passcode`). It works automatically
   once `FIREBASE_SERVICE_ACCOUNT` points at the preview project. **But** the
   allowlist (`approved_emails`) and memberships live in the preview Firestore,
   which starts empty — see Phase 5 seeding, or nobody can sign in.

## Phase 4 — Vercel env vars, Preview scope only 👤 (agent supplies the list)

Set these on the Vercel project with the **Preview** environment checked
(leave Production untouched — that's what keeps prod safe):

- `FIREBASE_SERVICE_ACCOUNT` — preview service-account JSON (Phase 2.3)
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` — `ibuild4you-preview`
- `NEXT_PUBLIC_FIREBASE_API_KEY` — preview web app API key (Phase 2.2)
- `NEXT_PUBLIC_FIREBASE_APP_ID` — preview web app ID (Phase 2.2)
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` — `preview.ibuild4you.com`

For local preview-env dev, create `.env.preview.local.tpl` (the agent can't
write `.env*` files — the secrets hook blocks them — so create it by hand) with
1Password refs:

```
FIREBASE_SERVICE_ACCOUNT=op://dev-secrets/ibuild4you-preview-sa/credential
NEXT_PUBLIC_FIREBASE_PROJECT_ID=ibuild4you-preview
NEXT_PUBLIC_FIREBASE_API_KEY=op://dev-secrets/ibuild4you-preview-web/apiKey
NEXT_PUBLIC_FIREBASE_APP_ID=op://dev-secrets/ibuild4you-preview-web/appId
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=preview.ibuild4you.com
```

Then `op inject -i .env.preview.local.tpl -o .env.preview.local` (run it
yourself — `op inject` is hook-blocked for the agent).

## Phase 5 — deploy rules/indexes + seed

Rules + indexes: **DONE** (2026-06-06) —
`firebase deploy --only firestore:rules,firestore:indexes --project preview`
ran clean against the new DB.

`scripts/with-preview-env.mjs` wrapper: **DONE** (reads `.env.preview.local`).

Still to seed (after the env flip + a real `.env.preview.local`):

- Test admin: `node scripts/with-preview-env.mjs node scripts/seed-test-admin.mjs`.
- Optionally a canonical test project or two for Playwright fixtures.

## Phase 6 — verify

1. Force-push a branch to preview: `git push origin <branch>:preview --force`.
2. On `preview.ibuild4you.com`: sign in (Google + passcode), create a throwaway
   project.
3. Confirm the write landed in **`ibuild4you-preview`** Firestore, and that prod
   (`ibuild4you-a0c4d`) shows nothing new. This is the whole point — verify it.

## Rollback

Delete the five Preview-scoped env vars on Vercel. Preview then falls back to
the Production env vars (today's behavior — preview writes to prod again).
No code to revert.
