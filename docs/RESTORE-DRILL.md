# Restore drill results

Counts and pass/fail only — no personal data. Re-run with the commands in [BACKUP-RESTORE.md](BACKUP-RESTORE.md#running-a-drill-recommended-monthly-and-before-any-move).

**When:** 2026-11-10, ~17:00 Dubai (13:00 UTC), branch `data-safety` (based on `website-upgrade`, schema through `005_website`).
**Target:** fresh database on the box's local Postgres 17 (`127.0.0.1:5433`), created by the drill and dropped afterwards. The live Render database was **not** touched; the backup files in `/workspace/studio/server/backups/` were only read.

## Drill 1 — latest live backup

File `live-20261110T114937Z.json` (taken 2026-11-10 15:49 Dubai from the live site, Postgres, schema 001–004, so **no media / site_settings / site_events tables**).

| table | in file | in restored DB |
| --- | ---: | ---: |
| audit_logs | 27 | 27 |
| users | 1 | 1 |
| auth_tokens | 0 | 0 |
| contact_messages | 0 | 0 |
| game_flights | 0 | 0 |
| game_tokens | 3 | 3 |
| games | 0 | 0 |
| game_versions | 0 | 0 |
| news_posts | 0 | 0 |
| sessions | 4 | 4 |
| media / site_events / site_settings | not in file | 0 (created by migration 005) |
| **total** | **35** | **35** |

| check | result |
| --- | --- |
| `npm run restore` exit code | PASS (0, ~0.5 s) |
| per-table counts match the file (10 tables) | PASS |
| Developer-rank account still Developer and not banned (1 in file, 1 in DB); `abood` is Developer | PASS |
| audit log count (27) and newest 5 entries (id, action, time) match; newest id 27 | PASS |
| sequences: all 10 serial sequences point past `max(id)` (`audit_logs` → 27, `users` → 1, empty tables → 1 unused) | PASS |
| fresh insert after restore (rolled back): new `users.id` 2 > 1, new `audit_logs.id` 28 > 27 | PASS |

**8/8 checks passed.**

The older file from the same day (`live-20261110T114916Z.json`, 57 rows: 12 users, 14 audit entries, 20 sessions, 11 game tokens) was drilled too: **8/8 passed** (Developer kept, fresh ids 13 and 15).

## Drill 2 — synthetic backup with media

Built by `scripts/make-synthetic-backup.ts`: the latest live backup's rows **plus** one game, 3 PNG images (≈200 KB each), one 5 MB MP4 trailer, a `site_settings` row (maintenance) and a `site_events` row, dumped with the real `dumpDatabase()` (media as `$base64`). Source SQLite → target Postgres, so it also proves cross-engine restore.

| table | in file | in restored DB |
| --- | ---: | ---: |
| audit_logs | 27 | 27 |
| users | 1 | 1 |
| game_tokens | 3 | 3 |
| games | 1 | 1 |
| media | 4 | 4 |
| sessions | 4 | 4 |
| site_events | 1 | 1 |
| site_settings | 1 | 1 |
| other 5 tables | 0 | 0 |
| **total** | **42** | **42** |

| check | result |
| --- | --- |
| restore exit code | PASS |
| per-table counts (13 tables) | PASS |
| Developer kept / `abood` Developer | PASS |
| audit log count + newest 5 | PASS |
| media bytes intact: every row's length == `size` and sha256 == stored `sha256` (4 rows, 5,842,916 bytes as `bytea`) | PASS |
| sequences (10), `media` sequence → 4 | PASS |
| fresh insert after restore | PASS |

**9/9 checks passed.** The same synthetic file also restored into a fresh SQLite file target (42 rows, 4 media).

## Automated tests (`server/tests/restore.test.ts`, 7 tests; run under SQLite and Postgres)

- round trip backup → JSON → restore: identical counts for every table (seed fills all 13), identical media bytes (PNG + 300 KB MP4), identical user rows/audit log, parents-before-children order, new inserts get ids above the restored max in 5 tables, Postgres `users` sequence == max(id)
- refuses a non-empty target without `--force`; `--force` replaces it
- rollback: an FK-violating row late in the file (even with `--force`) leaves the target exactly as before
- rejects before writing: unknown table, unknown column, corrupt media (sha256), size mismatch, invalid base64, malformed files
- restores a pre-005 dump (no media tables) into the current schema
- CLI: `--dry-run` leaves the target untouched, exit 3 on non-empty / wrong or missing `--confirm`, `--force --confirm <name>` works, bad JSON exit 2, output never contains row data

## Limits found

- The box cannot open Postgres connections to Render, and free Render web services have no shell or one-off jobs, so this drill proves the *file* and the *tool*, not a restore *into Render*. See the Dec 3 section of BACKUP-RESTORE.md.
- The live backups predate migration 005 (no media yet); media restore is proven only with the synthetic file until `website-upgrade` is deployed and a new backup is taken.
