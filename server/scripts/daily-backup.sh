#!/usr/bin/env bash
# Daily backup of the live Batlas Postgres to server/backups/live-<UTC timestamp>.json.
# Needs BATLAS_DATABASE_URL (Render "External Database URL") in the environment; it is never printed.
# Keeps the newest $KEEP files (default 30) and prints one summary line.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BATLAS_DATABASE_URL:?BATLAS_DATABASE_URL is not set}"
KEEP="${KEEP:-30}"
mkdir -p backups && chmod 700 backups
out="backups/live-$(date -u +%Y%m%dT%H%M%SZ).json"
if ! log=$(DATABASE_URL="$BATLAS_DATABASE_URL" npx --no-install tsx src/cli/backup.ts --out "$out" 2>&1); then
  # strip anything that looks like a connection string before showing the error
  echo "backup FAILED: $(printf '%s' "$log" | sed -E 's#postgres(ql)?://[^ ]*#<db-url>#g' | tail -n 1)" >&2
  rm -f "$out"; exit 1
fi
mapfile -t old < <(ls -1t backups/live-*.json 2>/dev/null | tail -n +"$((KEEP + 1))")
((${#old[@]})) && rm -f -- "${old[@]}"
kept=$(ls -1 backups/live-*.json | wc -l)
echo "backup ok: $out ($(du -h "$out" | cut -f1)), $(printf '%s' "$log" | grep -o '[0-9]* tables ([0-9]* rows)'); kept $kept, pruned ${#old[@]}"
