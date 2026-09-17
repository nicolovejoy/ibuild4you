# Preview ops credentials — op:// references only, safe to commit.
# Use with op run, never op inject (same rule as .env.ops.tpl):
#   op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/<script>.mjs
# with-preview-env.mjs inherits the injected env, then overlays .env.preview.local,
# so that file must exist but may be empty.
FIREBASE_SERVICE_ACCOUNT=op://dev-secrets/ibuild4you-preview-sa/credential
