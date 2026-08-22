# Ops-script credentials, as 1Password references. Safe to commit — references only,
# no secret values. See the secrets rule in the global CLAUDE.md.
#
# USE WITH `op run`, NOT `op inject`:
#
#   op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs
#
# This injects into the environment for one command and writes nothing to disk.
# `scripts/with-prod-env*.mjs` build their child env from `{ ...process.env }` and
# then overlay `.env.local`, so anything absent from `.env.local` is inherited from
# here rather than overridden.
#
# ⚠️ DO NOT `op inject -i .env.ops.tpl -o .env.local`. This file is the OPS SUBSET,
# deliberately not the whole app environment. As of 2026-08-22 `.env.local` also holds
# ANTHROPIC_API_KEY, the four AWS_* values, and the prod FIREBASE_SERVICE_ACCOUNT —
# none of which have a 1Password backup, so injecting over that file destroys them.
# Back those five up to `dev-secrets` first; only then is a complete `.env.tpl` safe
# to write, at which point this file should be folded into it and deleted.

# Read-only prod Firestore (datastore.viewer). Required by with-prod-env-ro.mjs,
# which refuses to fall back to the write-capable key — that refusal is the point.
#
# NOTE the reference shape: `ibuild4you-firestore-ro` is a DOCUMENT item and the key
# is an ATTACHED FILE, not a field. `op://dev-secrets/ibuild4you-firestore-ro/notesPlain`
# resolves to an empty string rather than failing, so a tpl pointing at the note would
# look correct and silently inject nothing. Address the filename instead.
FIREBASE_SERVICE_ACCOUNT_RO=op://dev-secrets/ibuild4you-firestore-ro/ibuild4you-a0c4d-286e00ab8e38.json

# Garm authz service. GARM_URL is not a secret; kept here so one file configures
# the whole ops path. GARM_KEY is the read-only consumer key (checks only);
# GARM_ADMIN_KEY is the separate grants-write key used by garm-seed-grants.mjs --live.
GARM_URL=https://garm.prompt-labs.org
GARM_KEY=op://dev-secrets/garm-consumer-ibuild4you/password
GARM_ADMIN_KEY=op://dev-secrets/garm/password

# Deliberately absent, and why:
#   CRON_SECRET     — ibuild4you's is prod-only on Vercel and has no dev-secrets item.
#                     (`garm-cron-secret` is Garm's own, NOT this app's — do not wire it here.)
#   GITHUB_TOKEN    — item `ibuild4you-feedback-to-issues` exists but its field name
#                     is unconfirmed; add the ref once verified rather than guessing.
