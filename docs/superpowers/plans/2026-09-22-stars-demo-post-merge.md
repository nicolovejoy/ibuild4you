# stars-demo Integration — Post-Merge Follow-Up Plan

PR #179 (`c8bbe34`) merged the stars-demo round-two integration. This plan covers the two pieces of follow-up code work that do not need Nico's credentials: a live smoke script that automates the spec 08 manual checklist, and the docs update from "PR open" to "merged". Spec: `/Users/nico/src/stars-demo/docs/specs/08-round-two.md` (§ "Manual checklist requiring live Firestore"); wire contract: `/Users/nico/src/stars-demo/docs/specs/08a-ibuild4you-contract.md`. Routes live under `app/api/integrations/stars-demo/*`; validation shapes in `lib/integration/validate.ts`; auth in `lib/api/integration-auth.ts`.

## Global Constraints

- **No participant text, names, or emails** in code, commit messages or output. Synthetic labels only ("Smoke P1"), synthetic bodies ("synthetic message one").
- **Never read `.env*` files.** The secret arrives in the environment as `STARS_INTEGRATION_SECRET`; the script never prints it, never echoes headers, and redacts it from any output it does print.
- **Never target production by accident.** Default base is `https://preview.ibuild4you.com`. A base whose host is `ibuild4you.com` or `www.ibuild4you.com` is refused unless `--allow-prod` is passed. Namespace erase runs only with `--namespace-erase` and never on a prod host, flag or not.
- **Error body is exactly** `{ "error": { "code": <ErrorCode>, "request_id": <uuid> } }`; statuses: `unauthorized` 401, `forbidden` 403, `stale` 409, `invalid_request` 400, `reply_pending` 202.
- **IDs** are `[A-Za-z0-9_-]{1,128}`; topics `star-data`, `admissions`, `self-service`; round `r2`. Send/delete keys `r2:<topic_id>:<participant_id>:<uuidv4>`; erase-person key `r2:erase:<participant_id>:<uuidv4>`; namespace erase `r2:namespace-erase:<uuidv4>`.
- **Vercel protection bypass**: when `.ibuild4you-bypass` exists at the repo root, send its trimmed contents as header `x-vercel-protection-bypass` on every request. Do not print it.
- **Commit attribution.** End every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run `npm run lint` before committing (scripts are linted). No new dependencies; Node 20+ built-in `fetch` and `node:crypto` only.

---

### Task 1: Live smoke script for the spec 08 checklist

**Files:**
- Create: `scripts/smoke-stars-integration.mjs`

Read the contract (`08a`) §2 (operations and shapes), §4 (errors), §7 (ensure participant) and the spec 08 § "Manual checklist requiring live Firestore" before writing anything. Read `lib/integration/validate.ts` to get every body field name exactly right, and `scripts/e2e-preview-login.mjs` + `scripts/lib/preview-login.mjs` for the house style of a live script (top-of-file comment explaining env + usage, plain `console.log`, non-zero exit on failure).

- [ ] **Step 1: Skeleton, flags, guards**

`node scripts/smoke-stars-integration.mjs [--allow-prod] [--namespace-erase]`. Env: `E2E_BASE` (default `https://preview.ibuild4you.com`), `STARS_INTEGRATION_SECRET` (required; if unset print one line naming the missing env var and exit 2). Apply the prod guard from Global Constraints. Build a `call(method, path, { body, headers, secret = true })` helper that adds `X-Integration-Namespace: stars-demo`, `X-Integration-Secret` (unless `secret: false`), `Content-Type: application/json`, and the bypass header when the file exists. It returns `{ status, json, request_id }`. Every check is `check(name, condition, detail)` that prints `ok  <name>` or `FAIL <name> — <detail>` and tallies.

- [ ] **Step 2: Checks, in this order (one synthetic cast per run, ids `smoke-<base36 epoch>-p1|p2|p3`)**

1. **Fail closed.** GET list without the secret → 401, body exactly the error shape with code `unauthorized` and a uuid `request_id`. GET with the secret but namespace header `other` → 401.
2. **Ensure.** p1 on all three topics, p2 on `star-data` only, p3 on `admissions` only, each with a synthetic label. Re-ensure p1 → same success status and identical returned participant fields (idempotent by id).
3. **Two members, one topic.** Record `star-data` version from list. p1 sends "synthetic message one" (with `topic_title`/`topic_prompt` synthetic strings) → 200; response has `message` and `reply`, `version` differs from the recorded one. p2 lists → sees p1's message then its reply in that order. p2 sends "synthetic message two" with `seen_version` = the version p2 just listed → 200. List twice; both lists identical and in `created_at` then id order, 4 messages.
4. **Non-member.** p3 sends in `star-data` → 403 `forbidden`. If the list operation takes a participant, p3 listing `star-data` → 403 as well; if it does not, record that in the script comment and skip.
5. **Retry-safe key.** Re-send p1's first request with the same idempotency key and body → 200, same `message.id` and `reply.id` as the first time; list still has 4 messages.
6. **Stale.** p1 sends with `seen_version: "not-the-current-version"` → 409 `stale`; list still has 4 messages.
7. **Delete cascade.** Delete p1's first message → 200; list no longer has that message or its reply; p2's message and reply remain; version changed.
8. **Erase person.** Erase p1 → 200. List all three topics: no message with `author_id` p1 and no reply that depended on p1 (use whatever dependency field the list exposes; if none, assert no reply immediately follows a p1 message and note it). Call the erase again with a new key → still success (idempotent / job-safe). Ensure p1 again → success (a fresh record).
9. **Leak check.** Concatenate every response body seen; assert it contains neither the secret value nor the `topic_prompt` string sent in step 3 (prompt is never stored or echoed), and that no body contains an `@`.
10. **Cleanup.** Erase p2 and p3. With `--namespace-erase` (non-prod only) call namespace erase last and assert each topic then lists empty with `version: "none"`.

Print a final line `N checks, F failed` and exit 1 if F > 0.

- [ ] **Step 3: Verify without a live target**

There is no live target with the secret yet, so: `node --check scripts/smoke-stars-integration.mjs`; run with `STARS_INTEGRATION_SECRET` unset → exits 2 with the one-line hint; run with a dummy secret and `E2E_BASE=https://ibuild4you.com` and no `--allow-prod` → refuses before any request; run with a dummy secret against the default preview base → the very first check (fail-closed 401) may pass or the run may stop at the first authenticated call with 401s; either way the script must not crash and must exit 1 with readable `FAIL` lines. Paste those three outputs into your report.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-stars-integration.mjs
git commit -m "Smoke script for the stars-demo integration: spec 08 checklist against a live deployment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Docs from "PR open" to "merged"

**Files:**
- Modify: `docs/changelog.md`, `CLAUDE.md`

- [ ] **Step 1: changelog**

In the entry that begins `**2026-09-22 (stars-demo round-two integration — PR #179 OPEN, branch \`stars-demo-integration\`, not merged):**` change the parenthetical to `(stars-demo round-two integration — PR #179 MERGED \`c8bbe34\`)`. Append to the end of that same entry, before its closing `---`: ` **Post-merge (same day):** prod serves the routes and fails closed (GET list without the secret → 401 with the fixed body). Still outstanding, all Nico-side: \`STARS_INTEGRATION_SECRET\` on Vercel preview + prod, \`firebase deploy --only firestore:indexes\` on \`ibuild4you-preview\` and \`ibuild4you-a0c4d\` (file has 16 indexes, both projects have 13 — purely additive), and pushing main to the \`preview\` branch. \`scripts/smoke-stars-integration.mjs\` automates the spec 08 manual checklist against a live base once the secret is set (refuses prod without \`--allow-prod\`, namespace erase only with \`--namespace-erase\`).`

- [ ] **Step 2: CLAUDE.md**

(a) In the `STARS_INTEGRATION_SECRET` env-var bullet, the 1Password reference currently names an item `ibuild4you-stars-integration`. Replace that item name with `starsdemo-ibuild4you-integration-secret` (keep the vault `dev-secrets` and the field `password` as they are) and add ` (item title verified 2026-09-22; field name assumed \`password\`)` right after the reference.
(b) In `## Next Steps`, insert a new paragraph directly after the paragraph that begins `**Garm cutover is live**`:

`**stars-demo round-two integration MERGED 2026-09-22 (PR #179, \`c8bbe34\`).** Server-to-server group-conversation API under \`app/api/integrations/stars-demo/*\`; plan \`docs/superpowers/plans/2026-09-22-stars-demo-round-two-integration.md\`, follow-up \`docs/superpowers/plans/2026-09-22-stars-demo-post-merge.md\`. **Three post-merge steps still open (Nico):** (1) \`STARS_INTEGRATION_SECRET\` on Vercel preview + prod — until then every integration request is a 401 by design; (2) \`firebase deploy --only firestore:indexes\` on both Firebase projects (three new \`integration_messages\` indexes); (3) push main to \`preview\` and run \`STARS_INTEGRATION_SECRET=… node scripts/smoke-stars-integration.mjs\` (spec 08 checklist; add \`--namespace-erase\` to wipe the synthetic cast). Then tell the stars-demo session it can point at prod. Namespace and round are hard-wired to \`stars-demo\`/\`r2\`; a second tenant or round three generalises those two constants first.`

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md CLAUDE.md
git commit -m "docs: stars-demo integration merged — post-merge steps, smoke script, 1Password item name

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
