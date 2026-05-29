# Preview Firestore Split — Runbook

Give preview deployments their own Firebase project so preview writes land in a
sandboxed DB instead of overwriting production. Closes the May 23 footgun (a
real maker's `requester_email` got overwritten from a preview write) and
unblocks agent-driven Playwright on `preview.ibuild4you.com`.

## Key insight: no app code changes

Both Firebase SDKs read entirely from environment variables:

- Admin SDK (`lib/firebase/admin.ts`) — `FIREBASE_SERVICE_ACCOUNT` (JSON blob)
- Client SDK (`lib/firebase/client.ts`) — `NEXT_PUBLIC_FIREBASE_API_KEY`,
  `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
  `NEXT_PUBLIC_FIREBASE_APP_ID`

So the split is **env-var scoping + Firebase/Vercel console work**, not a code
change. The whole job is: stand up a second Firebase project, then point
Vercel's *Preview* environment at it.

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

## Phase 2 — create the preview Firebase project 👤

1. Firebase console → Add project. Suggested ID: `ibuild4you-preview` (if it
   resolves to something else, update `.firebaserc`).
2. Create a **Web app** in the project → copy its config (`apiKey`, `appId`,
   `projectId`) — these become the `NEXT_PUBLIC_*` values in Phase 4.
3. Project settings → Service accounts → **Generate new private key** → this
   JSON becomes `FIREBASE_SERVICE_ACCOUNT` in Phase 4. Keep it out of the repo;
   store in 1Password `dev-secrets` (e.g. `op://dev-secrets/ibuild4you-preview-sa`).
4. Firestore → create database (production mode, same region as prod —
   `us-*` to match).

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

## Phase 5 — deploy rules/indexes + seed 🤖 (with Nico authenticated)

```
firebase deploy --only firestore:rules,firestore:indexes --project preview
```

Then seed the preview DB so sign-in works and there's something to look at:

- Test admin: a preview-scoped run of `scripts/seed-test-admin.mjs` (needs a
  `with-preview-env.mjs` wrapper analogous to `with-prod-env.mjs`, pointed at
  `.env.preview.local`). Agent can add that wrapper.
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
