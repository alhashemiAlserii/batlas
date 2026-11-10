#!/usr/bin/env bash
# Daily backup of the live Batlas site over HTTPS:
#   GET $BATLAS_URL/api/internal/backup  (Authorization: Bearer <token from server/data/backup-token.txt>)
# Saves server/backups/live-<UTC timestamp>.json, checks it is a real dump (users table containing abood),
# keeps the newest $KEEP files (default 30) and prints one summary line. The token is never printed.
# The free Render service sleeps when idle, so the first request may take ~1 minute: long timeout + retries.
set -euo pipefail
cd "$(dirname "$0")/.."
URL="${BATLAS_URL:-https://batlas-2je9.onrender.com}/api/internal/backup"
TOKEN_FILE="${BACKUP_TOKEN_FILE:-data/backup-token.txt}"
KEEP="${KEEP:-30}"
[ -r "$TOKEN_FILE" ] || { echo "backup FAILED: token file $TOKEN_FILE missing" >&2; exit 1; }
mkdir -p backups && chmod 700 backups
out="backups/live-$(date -u +%Y%m%dT%H%M%SZ).json"
tmp="$out.part"
trap 'rm -f "$tmp"' EXIT
code=000
for attempt in 1 2 3 4; do
  # header comes from a file via stdin so the token never appears in the process list
  code=$(printf 'Authorization: Bearer %s\n' "$(tr -d '\r\n' < "$TOKEN_FILE")" | \
    curl -sS -o "$tmp" -w '%{http_code}' --max-time 180 --connect-timeout 90 -H @- "$URL" 2>/dev/null) || code=000
  [ "$code" = 200 ] && break
  # 401/404 will not fix themselves; anything else (cold start, 502/503, network) gets retried
  case "$code" in 401|403|404) break ;; esac
  sleep $((attempt * 20))
done
[ "$code" = 200 ] || { echo "backup FAILED: HTTP $code after $attempt attempt(s)" >&2; exit 1; }
summary=$(node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const t = d.tables || {}; const users = t.users;
  if (!Array.isArray(users) || !users.some((u) => u.username === "abood")) { console.error("no users table with abood"); process.exit(1); }
  const rows = Object.values(t).reduce((n, r) => n + r.length, 0);
  console.log(`${Object.keys(t).length} tables, ${rows} rows, ${users.length} users, source ${d.source}, dumped ${d.createdAt}`);
' "$tmp") || { echo "backup FAILED: response is not a valid dump" >&2; exit 1; }
chmod 600 "$tmp" && mv "$tmp" "$out"
mapfile -t old < <(ls -1t backups/live-*.json 2>/dev/null | tail -n +"$((KEEP + 1))")
((${#old[@]})) && rm -f -- "${old[@]}"
echo "backup ok: $out ($(du -h "$out" | cut -f1)), $summary; attempt $attempt; kept $(ls -1 backups/live-*.json | wc -l), pruned ${#old[@]}"
