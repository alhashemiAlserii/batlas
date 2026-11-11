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
| **`POST /api/internal/restore`** | server (`src/routes/restore-endpoint.ts`, `src/lib/restore-stream.ts`) | Restore **over HTTPS** into the database the server uses. Off (404) unless `RESTORE_TOKEN` is set. Only in maintenance mode, only into an empty DB unless force + exact DB name. Same restore core as `npm run restore`. See the Option B runbook. |
| `server/scripts/restore-remote.ts` | box (or any computer with Node 24) | Client for that endpoint: streams a backup file, token read from a file, never printed. |
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

Size note: `npm run restore` loads the whole file into memory (as does the backup endpoint's response). Fine at today's size (the live dump is ~12 KB) and on any normal computer. The restore **endpoint** streams instead (see the Option B runbook), because it runs on a 512 MB Render instance.

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
- Free web services have **no shell and no one-off jobs**, and this box cannot open Postgres connections to Render. So `npm run restore` can't be run *against a Render database from here*. That is what `POST /api/internal/restore` is for: it runs inside the web service and only needs HTTPS.
- Free web service: 512 MB RAM, ephemeral disk, spins down after 15 minutes without traffic (render.com/docs/free, re-checked 2026-11-11). Env var changes: **Save and deploy** redeploys with the new values (render.com/docs/configure-environment-variables).

## The planned Dec 3 move (maintenance ON → final backup → restore → verify → maintenance OFF)

Because of the facts above there are two realistic ways to do it. Option A is simpler and removes the move entirely. **The owner chose Option B (stay on the free plan)**, so Option B is written out as a full runbook.

### Option A (not chosen): upgrade the existing database in place

Change `batlas-db-2je9`'s compute plan from Free to the smallest paid plan (`0.1c-256mb`, 256 MB RAM, $6/month on render.com/pricing as of 2026-11-10) before 2026-12-10. No data moves, no new connection string, no downtime beyond Render's plan change, and it adds point-in-time recovery (3 days on the Hobby workspace) and logical exports. Still take a backup + drill right before.

### Option B (chosen): stay free, move to a new free database — runbook

Only one free Postgres can be active per workspace, so the **old database must be deleted before the new one can be created**. That is the only irreversible step. Everything before it is there to make sure the backup is good, and everything after it can be repeated.

**Rules for the whole move**
- Do it well before **2026-12-10 ≈ 14:48 Dubai**, when the current free DB expires. Plan: **Dec 3**. If something goes wrong before step 6 you can simply stop, and you still have a week.
- One person drives (abood), and a second person (Abdallah) checks each ✅ gate before the next step.
- Backup files contain password hashes. Copy them only to the places listed in step 3. Never paste them into chat.
- Two different secrets: `BACKUP_TOKEN` (download) and `RESTORE_TOKEN` (upload). They **must differ**; if they are the same, the restore endpoint stays off (404).
- Times below are Dubai (UTC+4).

#### Step 0: preparation (days before, site stays live)

1. Merge `website-upgrade` → `data-safety` → `account-restore` into the deployed branch, and let Render deploy as usual, with **no `RESTORE_TOKEN` set**. The endpoint then answers 404. Check `/healthz` and sign in as abood.
2. On the box: `cd server && npm ci`. Run the full tests: `npm test && npm run test:pg`.
3. Make the restore token on the box. It is written straight to a gitignored file and never shown:
   ```bash
   cd server && (umask 077; node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" > data/restore-token.txt)
   ```
   On Dec 3 you open that file in an editor (not in chat) to copy the value into Render.
4. Run a restore drill with the newest daily backup: `npx tsx scripts/restore-drill.ts --file backups/<newest>.json`. It must pass all checks.

*Rollback:* nothing has changed yet. If the deploy misbehaves, use Render's **Rollback** to the previous deploy.

#### Step 1: maintenance ON

Turn on maintenance in `/studio-console` → Maintenance (signed in as abood), **and** set `MAINTENANCE_MODE=true` in the service's Environment (**Save and deploy**). You need the env var because the new database won't have the dashboard setting.

✅ Gate: a signed-out private browser window shows the maintenance page, and `/healthz` returns `{"ok":true}`.

*Rollback:* switch it off again (dashboard) and remove `MAINTENANCE_MODE` (Save and deploy).

#### Step 2: final backup

```bash
cd /workspace/studio/server && bash scripts/daily-backup.sh   # the checkout the daily backups live in; prints file name + counts only
```

✅ Gate: the summary shows `abood` as Developer and a user count that matches the dashboard.

*Rollback:* nothing to roll back. If the backup fails, fix it and re-run. Do **not** go on without a fresh backup taken *after* step 1, because anything written before maintenance went on would be missing.

#### Step 3: verify the backup BEFORE anything destructive

All of these must pass:

```bash
cd server
F=backups/<final>.json
npm run restore -- --file $F --dry-run                 # file is valid, loads into the current schema; per-table counts
npx tsx scripts/restore-drill.ts --file $F             # full local restore into a fresh Postgres + checks (Developer, audit, sequences, media)
sha256sum $F                                           # note the first 12 characters
```

Then make **at least two extra copies** of exactly this file, and check each copy's `sha256sum` matches:

| Copy | Where | Who |
| --- | --- | --- |
| 1 | `server/backups/` on the box (the original) | automatic |
| 2 | Abdallah's own computer or USB stick (encrypted with `age` or a password-protected archive) | Abdallah |
| 3 | one off-box option from [OFFSITE-BACKUP-OPTIONS.md](OFFSITE-BACKUP-OPTIONS.md) (needs Abdallah's approval), or a second device | Abdallah |

Keep the previous 30 daily backups too (the box script already does).

✅ Gate (all must be true): dry-run OK; drill shows all PASS; the dry-run's user and audit_logs counts match the dashboard; 3 copies with identical sha256.

*Rollback:* turn maintenance off (step 1 rollback). Nothing is lost.

#### Step 4 (optional rehearsal on the live service): dry-run through the endpoint

Set `RESTORE_TOKEN` on the service (paste from `data/restore-token.txt`; **Save and deploy**; maintenance stays on), then from the box:

```bash
cd server
npx tsx scripts/restore-remote.ts --url https://batlas-2je9.onrender.com --preflight            # says: NOT EMPTY (the old DB), that's expected
npx tsx scripts/restore-remote.ts --url https://batlas-2je9.onrender.com --file $F --dry-run     # uploads, validates every row, writes NOTHING
```

✅ Gate: the dry run prints `DRY RUN OK` with the same counts as step 3. This proves the token, HTTPS upload, Render's proxy and the 512 MB instance all work before the old database is gone.

*Rollback:* remove `RESTORE_TOKEN` (Save and deploy). A dry run writes nothing.

#### Step 5: last check before the point of no return

Re-read: the final backup (step 2) was taken **after** maintenance went on; step 3 gate passed; 3 copies exist. Write down the old DB's name, region (Frankfurt) and Postgres version (18), so the new one matches.

#### Step 6: ⚠️ delete the old database (IRREVERSIBLE, last resort)

Only after steps 1–5 pass. In Render → the old database (`batlas-db…`) → Settings → **Delete Database**. Once this is done, **the backup files are the only copy of the data.**

*Rollback:* none for the database itself. Recovery from here on means restoring a backup copy (steps 7–9 can be repeated as often as needed).

#### Step 7: create the new database and point the service at it

1. Render → **New → Postgres**: name `batlas-db` (the name in `render.yaml`), database `batlas`, user `batlas`, region **Frankfurt**, Postgres **18**, plan **Free**.
2. The service's `DATABASE_URL` must become the new DB's **Internal Database URL**. Use the Environment page, or check that the Blueprint's `fromDatabase: batlas-db` picks it up; either way, *look* that it changed. Keep `MAINTENANCE_MODE=true` and `RESTORE_TOKEN` set. Make sure **`BOOTSTRAP_DEVELOPER_PASSWORD` is NOT set**; otherwise the first boot creates a fresh `abood` and the database is no longer empty. **Save and deploy.**
3. The app runs the migrations on boot (creating empty tables).

✅ Gate: `/healthz` is OK, and
```bash
npx tsx scripts/restore-remote.ts --url https://batlas-2je9.onrender.com --preflight
```
prints `Target database: batlas  maintenance: on  EMPTY`.

*Rollback:* if the deploy fails or the DB isn't empty, fix the env vars and redeploy. If it shows rows (e.g. a bootstrap Developer), either delete and recreate the new DB, or use `--force --confirm batlas` in step 8. Nothing from the backup has been touched.

#### Step 8: restore through the endpoint

```bash
cd server
npx tsx scripts/restore-remote.ts --url https://batlas-2je9.onrender.com --file $F --dry-run   # again, now against the new empty DB
npx tsx scripts/restore-remote.ts --url https://batlas-2je9.onrender.com --file $F             # the real restore
```

The server streams the upload to temp files, validates every row and media checksum, then writes everything in **one transaction**: parents first, media sha256 checked, sequences moved to max(id). Any error means a full rollback and the database stays empty.

✅ Gate: the client prints `RESTORED`, with the per-table counts equal to step 3's dry-run, and `Developers in backup: 1, in database now: 1`.

*Rollback:* if it fails, nothing was written, so fix and re-run (rate limit: 10 requests per hour per IP; `RESTORE_RATE_LIMIT`). If it succeeded with the wrong file, re-run with the right file using `--force --confirm batlas` (that replaces everything, in one transaction).

#### Step 9: verify

- Counts: every table equals the backup's count. `audit_logs` has **+1** (`restore.completed`), plus one more per refused attempt made after the restore.
- Sign in as **abood**: the rank shows DEVELOPER and `/studio-console` opens.
- Dashboard: player count is as before, and the newest audit entries are the pre-move ones plus `restore.completed`.
- Sequences: create a news **draft** and delete it again (proves new ids don't collide).
- Sign in as one normal test player (if you have one) to check that password hashes survived.

*Rollback:* if anything is wrong, keep maintenance on and re-run step 8 with `--force --confirm batlas` (or delete and recreate the new DB and repeat steps 7–8).

#### Step 10: open the site and close the restore door

1. Remove **`RESTORE_TOKEN`** from the Environment (the endpoint goes back to 404). Remove `MAINTENANCE_MODE`. **Save and deploy.**
2. If the restored `site_settings` still has maintenance on (the backup was taken with the dashboard switch on), switch it off in `/studio-console`.
3. Take a fresh backup with `daily-backup.sh` and check its counts match. Delete `data/restore-token.txt` on the box (`shred -u` or `rm`).
4. Note the new expiry: **30 days after the new DB's creation date** (if it was created Dec 3, that is about Jan 2), and put the next move in the calendar.

*Rollback:* if the site misbehaves, turn maintenance back on and investigate. The data is safe in the new DB and in the backups.

#### Restore endpoint reference

| Request | Answer |
| --- | --- |
| `RESTORE_TOKEN` unset, shorter than 32 characters, or equal to `BACKUP_TOKEN` | **404** (the endpoint doesn't exist) |
| missing or wrong `Authorization: Bearer …` (constant-time compare) | **401** |
| maintenance mode off | **423** `maintenance_off` |
| target not empty, without `force=1` **and** `confirm=<exact database name>` | **409** `not_empty` / `confirm_mismatch` |
| another restore running | **409** `busy` |
| larger than `RESTORE_MAX_BYTES` (default 2 GiB) | **413** |
| bad / truncated / corrupt backup (bad JSON, media sha256 mismatch, unknown column, …) | **400** `bad_backup`, nothing written |
| `?preflight=1` | 200: database name, empty?, non-empty table counts (no body read) |
| `?dryRun=1` | 200: per-table counts, nothing written |
| more than `RESTORE_RATE_LIMIT` (default 10) requests per IP per hour | **429** |

Audit: a successful restore writes `restore.completed` (counts, bytes, duration) **inside** the restore transaction. Refusals, dry runs and failures are written to the server log (`[restore] …`, never the token), and also to `audit_logs` when the database already has users. That way an empty target stays empty for the real restore. Responses contain counts only, never rows.

While `RESTORE_TOKEN` is set, the server allows requests up to 2 hours (`RESTORE_REQUEST_TIMEOUT_MS`) instead of Node's default 5 minutes, so a large upload is not cut off. I have **not** verified whether Render's own proxy limits long uploads; at today's size (~12 KB) it doesn't matter.

**Memory (measured on the box, server process with `--max-old-space-size=256`, peak RSS from `/proc/<pid>/status` VmHWM):**

| Backup | Target | Peak RSS | Time |
| --- | --- | --- | --- |
| 214 MB file, 16 × 10 MB media | SQLite | 216 MB | 5.5 s |
| 214 MB file, 16 × 10 MB media | Postgres (local) | 277 MB | 6.6 s |
| **1.6 GB file, 30 × 40 MB media (largest tested)** | SQLite | 363 MB | 42 s |
| **1.6 GB file, 30 × 40 MB media (largest tested)** | Postgres (local) | 380 MB | 57 s |

How it stays small: the upload is parsed as a token stream (`stream-json`), every table is written to an NDJSON temp file row by row, and every `$base64` media value is decoded straight into its own binary file (it never exists as one big string). The write pass reads one row at a time into one reused buffer. On Postgres, media larger than 16 MB is inserted in 16 MB pieces (`data = data || piece`); while that happens, Postgres temporarily keeps old row versions until autovacuum. The idle server alone uses ~115–125 MB. 40 MB is the site's own video upload limit. The vitest memory test (`tests/restore-memory.test.ts`) runs the 160 MB case on every `npm test` and fails above 400 MB; bigger runs: `RESTORE_MEM_MEDIA=30 RESTORE_MEM_MB=40 RESTORE_MAX_BYTES=3000000000 npx vitest run tests/restore-memory.test.ts`. Staging needs free disk of about the backup size (temp dir, removed afterwards; `RESTORE_TMP_DIR`). Not tested on an actual Render instance (we never touch the live service).

**Local rehearsal (2026-11-11, box):** I created a fresh local Postgres database (`batlas_optb_drill`) and ran the server on 127.0.0.1:3500 with `MAINTENANCE_MODE=true` and a generated `RESTORE_TOKEN`. Using the newest live backup (`live-20261111T114544Z.json`, 36 rows, schema 001–004), the client ran preflight (EMPTY), then dry-run (OK), then restore (OK; 1 Developer). Checked directly in the database afterwards: every table matched the backup (audit_logs +2 = `restore.completed` + one deliberate refused attempt), `abood` is DEVELOPER, and the users sequence = max id. The client refused to resend to the now non-empty DB, and the server refused `--force` with the wrong DB name (409). Then the database was dropped and the temp copies deleted.
