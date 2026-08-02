# Preview Firestore Split — COMPLETE & VERIFIED (2026-06-06)

Preview deploys now write to a **sandboxed Firebase project** (`ibuild4you-preview`)
instead of prod. Closes the May 23 footgun (a real maker's `requester_email` was
overwritten from a preview write) and unblocks agent-driven Playwright on
`preview.ibuild4you.com`.

**Verified:** signed into `preview.ibuild4you.com` and the dashboard showed only
the seeded `Test Admin Access (Playwright)` project — which exists solely in the
preview DB. Prod is untouched.

## How it works

Both Firebase SDKs read entirely from env vars, so the split is env-var scoping
plus one code fix:

- Admin SDK (`lib/firebase/admin.ts`) — `FIREBASE_SERVICE_ACCOUNT` (JSON blob)
- Client SDK (`lib/firebase/client.ts`) — `NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID}`

On Vercel these 5 vars are now **split per-environment**: Production keeps the
prod project's values; Preview points at `ibuild4you-preview`. Development was
left on prod (local dev uses `.env.local`, not Vercel's Development scope).

**Code fix** (`next.config.ts`): the `/__/auth/*` rewrite was hardcoded to the
prod project's `firebaseapp.com`, which would route preview's Google sign-in
handshake through prod. Now derives the destination from
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` (defaults to prod — a no-op on prod).

## What exists in `ibuild4you-preview`

- Firestore `(default)` DB, `nam5` multi-region, with prod's `firestore.rules` +
  `firestore.indexes.json` deployed.
- Firebase Auth initialized; Google sign-in enabled; `preview.ibuild4you.com`
  authorized.
- A seeded test admin (`test@ibuild4you.com`, admin role, passcode) +
  its host project, via `scripts/seed-test-admin.mjs`.
- Public web config: projectId `ibuild4you-preview`,
  appId `1:149838762833:web:2938264c76e7965fad3970`, project number
  `149838762833`. (API key omitted here — it's public but the literal trips
  GitHub secret-scanning; pull it from the Vercel Preview env or Firebase
  console > Project settings.)

## Operating it

Run any script against the preview DB with the wrapper (mirrors
`with-prod-env.mjs`, reads `.env.preview.local`):

```
node scripts/with-preview-env.mjs node scripts/list-projects.mjs
node scripts/with-preview-env.mjs node scripts/seed-test-admin.mjs --apply
```

`.env.preview.local` is gitignored. Build/refresh it from the 1Password item
(`op read` is hook-blocked for the agent — run it yourself):

```
echo "FIREBASE_SERVICE_ACCOUNT=$(op read 'op://dev-secrets/ibuild4you-preview-sa/credential' | jq -c .)" > .env.preview.local
```

Deploy rules/index changes to preview (prod is the bare-`firebase deploy`
target, so always pass `--project preview`):

```
firebase deploy --only firestore:rules,firestore:indexes --project preview
```

Push a feature branch to the preview environment:
`git push origin <branch>:preview --force`.

## Gotchas hit (so the next person doesn't)

- **Service-account JSON must be ONE physical line** in env files/Vercel, with
  the private key's breaks as escaped `\n` inside the string. Real newlines →
  invalid JSON ("unterminated string"); no newlines → bad PEM ("DECODER
  unsupported"). Always pipe through `jq -c .` from the pristine download.
- **`auth/configuration-not-found`** on Admin SDK user calls means Firebase Auth
  was never initialized on the project — enabling the API isn't enough; click
  **Get started** in the console Authentication tab once.
- The Firebase Web **API key is public** (ships in the browser bundle); GitHub
  secret-scanning flags it as a false positive — dismiss it.

## Rollback

Remove the 5 Preview-scoped env vars on Vercel **and redeploy** (env-var changes
need a redeploy to take effect) — Preview then falls back to the Production
values, i.e. today-minus-this-work behavior. The `next.config.ts` change is a
no-op on prod and can stay.
