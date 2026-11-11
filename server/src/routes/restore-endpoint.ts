import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Knex } from 'knex';
import type { Ctx } from '../lib/types.js';
import { audit } from '../lib/audit.js';
import { getMaintenance, clearMaintenanceCache } from '../lib/maintenance.js';
import { nonEmptyTables, restoreFromSource, RestoreError, SKIP_TABLES } from '../lib/restore.js';
import { stageBackup, UploadTooLarge } from '../lib/restore-stream.js';

/**
 * POST /api/internal/restore: restore a backup over HTTPS into the database this server uses.
 * Meant for moving to a new (empty) Render database from a machine that cannot reach Render's
 * Postgres port. Same restore core as `npm run restore` (one transaction, FK order, media
 * sha256 check, sequence reset).
 *
 *   - 404 unless RESTORE_TOKEN is set, 32+ chars, and different from BACKUP_TOKEN.
 *   - Authorization: Bearer <RESTORE_TOKEN> (constant-time compare) else 401.
 *   - Only while maintenance mode is ON (MAINTENANCE_MODE=true or the dashboard switch), else 423.
 *   - Only into an EMPTY database, unless ?force=1&confirm=<exact database name> (else 409).
 *   - ?preflight=1  checks all of the above and reports the target, without reading a body.
 *   - ?dryRun=1     reads and validates the whole upload, returns counts, writes nothing.
 *   - The body is the backup JSON file itself, streamed; it is staged to private temp files
 *     row by row, never held in memory whole. Max size RESTORE_MAX_BYTES (default 2 GiB).
 *   - Rate-limited (RESTORE_RATE_LIMIT per IP per hour, default 10). One restore at a time.
 *   - Responses contain counts only, never row contents. The token is never logged.
 */
const SYSTEM_ACTOR = { id: 0, username: 'restore-endpoint', role: 'SYSTEM' };

export function databaseName(db: Knex): Promise<string> | string {
  if (String(db.client.config.client).includes('pg')) return db.raw('select current_database() as n').then((r: any) => String(r.rows[0].n));
  const f = (db.client.config.connection as { filename?: string } | undefined)?.filename ?? ':memory:';
  return f === ':memory:' ? ':memory:' : path.basename(f);
}

/** req.ip, or '?' once the socket is gone. */
const safeIp = (req: Request) => { try { return req.ip ?? '?'; } catch { return '?'; } };

const flag = (v: unknown) => v === '1' || v === 'true' || v === 'yes';

export function mountRestoreEndpoint(app: Express, ctx: Ctx) {
  const { config, db } = ctx;
  const token = config.restoreToken;
  const enabled = !!token && token.length >= 32 && token !== config.backupToken;
  if (token && !enabled) console.warn(`[restore] RESTORE_TOKEN is set but ${token.length < 32 ? 'shorter than 32 characters' : 'the same as BACKUP_TOKEN'}: the restore endpoint stays disabled.`);
  const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.restoreRateLimit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many restore requests', code: 'rate_limited' } });
  const want = enabled ? crypto.createHash('sha256').update(token!).digest() : null;
  let busy = false;

  /** Writes to audit_logs only when the database already has users (an empty target must stay empty for the restore); always logs a one-line summary (no secrets, no data). */
  const record = async (req: Request, action: string, details: Record<string, unknown>) => {
    const ip = (req.res?.locals.ip as string | undefined) ?? safeIp(req);
    console.log(`[restore] ${action} ip=${ip} ${JSON.stringify(details)}`);
    try {
      if ((await db('users').count({ n: '*' }).first())?.n as number > 0) await audit(db, { ip } as Request, { action, category: 'admin', details }, SYSTEM_ACTOR);
    } catch { /* never fail a response because of logging */ }
  };
  const reply = (req: Request, res: Response, status: number, body: Record<string, unknown>) => {
    if (res.locals.restoreLock) { res.locals.restoreLock = false; busy = false; } // release before answering, so a quick retry is not "busy"
    res.status(status).json(body);
    if (!req.readableEnded) req.resume(); // drain any upload we are not going to read
  };

  app.post('/api/internal/restore', (req, res, next) => {
    if (!enabled) return reply(req, res, 404, { error: 'Not found' });
    next();
  }, limiter, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.locals.ip = safeIp(req);
    const started = Date.now();
    let staged: Awaited<ReturnType<typeof stageBackup>> | null = null;
    try {
      const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''));
      const got = crypto.createHash('sha256').update(m?.[1] ?? '').digest();
      if (!m || !crypto.timingSafeEqual(want!, got)) {
        await record(req, 'restore.denied', { reason: 'bad_token' });
        return reply(req, res, 401, { error: 'Unauthorized' });
      }
      clearMaintenanceCache(db);
      if (!(await getMaintenance(db)).on) {
        await record(req, 'restore.denied', { reason: 'maintenance_off' });
        return reply(req, res, 423, { error: 'Turn maintenance mode on (MAINTENANCE_MODE=true) before restoring.', code: 'maintenance_off' });
      }
      if (busy) return reply(req, res, 409, { error: 'Another restore is already running.', code: 'busy' });
      busy = true;
      res.locals.restoreLock = true;

      const q = req.query as Record<string, string | undefined>;
      const dryRun = flag(q.dryRun), force = flag(q.force), preflight = flag(q.preflight);
      const database = await databaseName(db);
      const existing = await nonEmptyTables(db);
      const empty = existing.length === 0;
      const nonEmpty = Object.fromEntries(existing.map((e) => [e.table, e.rows]));
      if (preflight) {
        return reply(req, res, 200, { ok: true, preflight: true, database, empty, nonEmpty, maintenance: true, maxBytes: config.restoreMaxBytes });
      }
      if (!empty && !dryRun) {
        if (!force) {
          await record(req, 'restore.denied', { reason: 'not_empty', database });
          return reply(req, res, 409, { error: `Database "${database}" is not empty. To REPLACE everything in it, add force=1 and confirm=<exact database name>.`, code: 'not_empty', database, nonEmpty });
        }
        if (q.confirm !== database) {
          await record(req, 'restore.denied', { reason: 'confirm_mismatch', database });
          return reply(req, res, 409, { error: `confirm must be the exact database name ("${database}").`, code: 'confirm_mismatch', database, nonEmpty });
        }
      }
      const len = Number(req.headers['content-length']);
      if (Number.isFinite(len) && len > config.restoreMaxBytes) return reply(req, res, 413, { error: `Upload is larger than RESTORE_MAX_BYTES (${config.restoreMaxBytes}).`, code: 'too_large' });

      staged = await stageBackup(req, { maxBytes: config.restoreMaxBytes, tmpDir: config.restoreTmpDir ?? undefined });
      const appCounts = Object.entries(staged.counts).filter(([t]) => !SKIP_TABLES.has(t));
      const rows = appCounts.reduce((a, [, n]) => a + n, 0);
      const summary = { database, bytes: staged.bytes, tables: appCounts.length, rows, developers: staged.developers, backupSource: staged.meta.source, backupCreatedAt: staged.meta.createdAt };
      const r = await restoreFromSource(db, staged.source, {
        force: force && !empty, dryRun,
        beforeCommit: async (trx, result) => {
          await audit(trx, { ip: res.locals.ip } as Request, { action: 'restore.completed', category: 'admin', details: { ...summary, force: force && !empty, wiped: result.wiped.reduce((a, w) => a + w.rows, 0), ms: Date.now() - started } }, SYSTEM_ACTOR);
        },
      });
      clearMaintenanceCache(db);
      if (dryRun) await record(req, 'restore.dry_run', summary);
      else console.log(`[restore] restore.completed ip=${res.locals.ip} ${JSON.stringify(summary)}`);
      const developersNow = dryRun ? null : Number((await db('users').where({ role: 'DEVELOPER' }).count({ n: '*' }).first())!.n);
      return reply(req, res, 200, {
        ok: true, dryRun, ...summary, empty,
        counts: r.restored, notInBackup: r.notInBackup,
        wiped: r.wiped, developersAfter: developersNow,
        note: dryRun ? 'Dry run: validated every row and media checksum, wrote nothing.' : 'Restored in one transaction. audit_logs has one extra row (restore.completed).',
        ms: Date.now() - started,
      });
    } catch (e) {
      if (e instanceof RestoreError) {
        await record(req, 'restore.failed', { reason: e.message.slice(0, 200) });
        return reply(req, res, e instanceof UploadTooLarge ? 413 : 400, { error: `Restore failed, nothing was changed: ${e.message}`, code: e instanceof UploadTooLarge ? 'too_large' : 'bad_backup' });
      }
      await record(req, 'restore.failed', { reason: 'server_error' });
      if (!res.headersSent) return reply(req, res, 500, { error: 'Restore failed, nothing was changed (server error; see the server log).', code: 'server_error' });
      next(e);
    } finally {
      if (staged) await staged.cleanup().catch(() => {});
      if (res.locals.restoreLock) { res.locals.restoreLock = false; busy = false; }
    }
  });
}
