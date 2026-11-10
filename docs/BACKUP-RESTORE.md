# Backup and restore

> Backup files contain password hashes and user data. Never commit them, paste them into chat, or
> print them. Commands below only ever print table names and row counts.

## What exists

| Piece | Where | What it does |
| --- | --- | --- |
| `GET /api/internal/backup` | server (`src/routes/…`, `src/lib/backup.ts`) | Bearer-token (`BACKUP_TOKEN`, 32+ chars) JSON dump of every table, rate-limited and audit-logged. Media (`bytea`/blob) is base64: `{"$base64": "…"}`. |
| `server/scripts/daily-backup.sh` | box | Calls the endpoint over HTTPS with the token from `server/data/backup-token.txt`, checks the dump has `abood`, keeps the newest 30 files in `server/backups/` (chmod 600, gitignored). |
| `npm run backup` | anywhere that can reach the DB | Same dump, straight from `DATABASE_URL` / the SQLite file. |
| **`npm run restore`** | anywhere that can reach the target DB | Loads a dump back (this document). |
| `scripts/restore-drill.ts` | box (local Postgres) | Restores a dump into a brand-new local database and verifies it. Results: [RESTORE-DRILL.md](RESTORE-DRILL.md). |

Backups currently exist **only on this box**. Off-box options are in [OFFSITE-BACKUP-OPTIONS.md](OFFSITE-BACKUP-OPTIONS.md) (not set up; needs Abdallah's approval).

## `npm run restore`

```bash
cd server
# 1. Always first: validate the file. Touches no database (test-loads it into in-memory SQLite).
npm run restore -- --file backups/live-YYYYMMDDTHHMMSSZ.json --dry-run

# 2. Restore into an EMPTY database (target = DATABASE_URL, or the SQLite file DB_FILE when unset)
DATABASE_URL='postgres://…/newdb' npm run restore -- --file backups/live-….json --confirm newdb

# 3. Replace a database that already has rows (wipes every app table first, same transaction)
DATABASE_URL='postgres://…/newdb' npm run restore -- --file backups/live-….json --force --confirm newdb
```

What it does, in order:

1. Parses and checks the file (shape, table names, rows are objects, a `users` table exists). Bad JSON or a bad shape → exit 2, nothing touched.
2. Runs migrations on the target (so a dump from an older schema, e.g. before `005_website`, loads into the current schema; new columns get their defaults, new tables stay empty).
3. Counts rows in the target. **Non-empty → refused (exit 3)** unless `--force` **and** the database name is typed (`--confirm <name>` or at the interactive prompt). A target that is not on this machine (not localhost/127.x) **always** needs `--confirm <name>`, even when empty, so a stray `DATABASE_URL` can't be hit by accident.
4. In **one transaction**: validates every row against the target's columns (unknown table/column → abort), turns `$base64` back into bytes and checks each media row's `size` and `sha256`, (with `--force`) empties the app tables children-first, inserts parents-first (order computed from the real foreign keys), then moves every Postgres serial sequence to `max(id)` (`setval`), and re-counts. Any error → **rollback, the target is unchanged** (exit 1).
5. Prints a per-table `in file / in database` table and the sequence values. Never prints rows, the URL or credentials (Postgres targets are shown as `host:port/db`).

Not restored on purpose: `knex_migrations`, `knex_migrations_lock` (the target's own migration state is authoritative).

Exit codes: `0` ok, `1` restore failed (rolled back), `2` bad arguments/file, `3` refused (non-empty or missing/wrong confirmation).

Size note: the whole file is loaded into memory (as is the backup endpoint's response). Fine for the free 1 GB database; media rows are inserted one at a time.

### Running a drill (recommended monthly and before any move)

```bash
cd server
npx tsx scripts/restore-drill.ts --file /workspace/studio/server/backups/<latest>.json
# synthetic dump with media (PNG + 5 MB MP4) on top of a real backup, for the bytea path:
npx tsx scripts/make-synthetic-backup.ts --from <latest>.json --out /tmp/drill/synthetic.json
npx tsx scripts/restore-drill.ts --file /tmp/drill/synthetic.json --db batlas_restore_drill_media
```

The drill (re)creates the database on the local Postgres (`127.0.0.1:5433`, refuses other hosts), runs the real CLI, checks counts, Developer rank, audit log, media hashes, sequences and a fresh insert (rolled back), then drops the database (`--keep` to keep it).

## Important Render facts (checked 2026-11-10 on render.com/docs/free)

- Only **one** Free Postgres database can be active per workspace.
- Free Postgres expires **30 days** after creation (ours: 2026-12-10 ≈ 14:48 Dubai), then a 14-day grace period in which it can only be upgraded; after that Render deletes it with all data.
- Free Postgres has **no backups of any kind** (no PITR, no exports). Our JSON dumps are the only copy.
- Free web services have **no shell and no one-off jobs**, and this box cannot open Postgres connections to Render. So `npm run restore` can't currently be run *against a Render database from here*.

## The planned Dec 3 move (maintenance ON → final backup → restore → verify → maintenance OFF)

Because of the facts above there are two realistic ways to do it. **Option A is simpler and safer; it removes the move entirely.**

### Option A (recommended): upgrade the existing database in place

Change `batlas-db-2je9`'s compute plan from Free to the smallest paid plan (`0.1c-256mb`, 256 MB RAM, $6/month on render.com/pricing as of 2026-11-10) before 2026-12-10. No data moves, no new connection string, no downtime beyond Render's plan change, and it adds point-in-time recovery (3 days on the Hobby workspace) and logical exports. Still take a backup + drill right before.

### Option B: stay free, move to a new free database

Only one free DB may be active, so the old one has to be **deleted before** the new one can be created. That is irreversible, so every step below must pass before the next:

1. **Maintenance ON** (Maintenance switch in `/studio-console`, signed in as the Developer). Wait a minute; confirm the site shows the maintenance page to a signed-out browser.
2. **Final backup**: `bash server/scripts/daily-backup.sh` → note the file name and its summary line. Make a second copy off the box (see off-box options) so the only copy is not on one machine.
3. **Prove it restores**: `npm run restore -- --file <final>.json --dry-run`, then `npx tsx scripts/restore-drill.ts --file <final>.json`. All checks must PASS; compare the user count with the dashboard.
4. Delete the old free database in Render (only after 2 and 3). Create the new free database (same region, Postgres 18), point the web service's `DATABASE_URL` at it and redeploy. The app runs migrations on boot; with `BOOTSTRAP_DEVELOPER_PASSWORD` unset it creates no users. **Maintenance is stored in the old DB, so set `MAINTENANCE_MODE=true` on the service before this redeploy** to keep the site closed.
5. **Restore into the new DB** from a machine that can reach it (Render's *external* URL; e.g. Abdallah's computer with Node 24 and this repo):
   `DATABASE_URL='<new external URL>' npm run restore -- --file <final>.json --confirm <new db name>` (add `--force` only if it reports rows from the first boot).
   *This box can't do this step today.* If no other machine is available, a token-protected one-shot restore endpoint would be needed; it is **not built** (it would be a powerful write endpoint and should be a deliberate decision).
6. **Verify**: the restore's table must show `in file == in database` for every table; sign in as `abood` (Developer), check the dashboard counts, the audit log's newest entries, and create + delete a test news draft (proves sequences).
7. **Maintenance OFF**: the final backup was taken with maintenance ON, so the restored `site_settings` row keeps it on — good, the site stays closed while you verify. Remove `MAINTENANCE_MODE` from the service env (redeploy), then switch maintenance off in `/studio-console`. Take a fresh backup.

If any step fails before step 4, turn maintenance off and nothing is lost. After step 4 the backup files are the only copy, which is why step 2's off-box copy matters.
