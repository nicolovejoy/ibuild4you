#!/usr/bin/env bash
# Push secrets from 1Password to Vercel without the value ever touching disk or
# the terminal. `op read` fills a shell variable that is piped into
# `vercel env add --sensitive`, so the variable is stored as a Secret (not
# readable back from the dashboard) and an empty read never overwrites one.
#
# One variable:
#   scripts/push-env.sh VAR_NAME 'op://vault/item/field' production,preview
#
# Every op:// line of a template file (KEY=op://... lines; other lines skipped):
#   scripts/push-env.sh --from .env.production.tpl production
#
# Add --dry-run anywhere to print what would be pushed (names and references
# only, never values). Requires `op` signed in and `vercel` linked to the project.
set -euo pipefail

DRY=0
ARGS=()
for a in "$@"; do
  if [ "$a" = "--dry-run" ]; then DRY=1; else ARGS+=("$a"); fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

push_one() {
  local name="$1" ref="$2" envs="$3"
  case "$ref" in
    op://*) ;;
    *) echo "skip $name: not an op:// reference" >&2; return 0 ;;
  esac
  echo "push $name  <-  $ref  ->  $envs"
  if [ "$DRY" = 1 ]; then return 0; fi
  # Read into a variable first so a failed or empty read stops here instead of
  # storing an empty secret. The value is never echoed.
  local value
  value=$(op read -n "$ref") || { echo "op read failed for $name" >&2; return 1; }
  if [ -z "$value" ]; then
    echo "refusing to push $name: $ref read back empty" >&2
    return 1
  fi
  # --force overwrites an existing value in the same environment, so the same
  # command works for first set and for rotation.
  printf %s "$value" | vercel env add "$name" -e "$envs" --sensitive --force --yes
}

if [ "${1:-}" = "--from" ]; then
  file="${2:?template file}"; envs="${3:?environments, e.g. production or production,preview}"
  [ -r "$file" ] || { echo "cannot read $file" >&2; exit 1; }
  # Lines look like KEY=op://vault/item/field, optionally quoted.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    if ! [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*\"?(op://[^\"[:space:]]+)\"?[[:space:]]*$ ]]; then
      case "$line" in *op://*) echo "skip: unparsed op:// line" >&2 ;; esac
      continue
    fi
    push_one "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "$envs"
  done < "$file"
else
  name="${1:?VAR_NAME}"; ref="${2:?op://vault/item/field}"; envs="${3:?environments}"
  push_one "$name" "$ref" "$envs"
fi
