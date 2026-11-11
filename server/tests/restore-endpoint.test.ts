import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { testDb } from './helpers.js';
import { seed } from './restore-seed.js';
import { createApp } from '../src/app.js';
import { insertId } from '../src/db/index.js';
import { dumpDatabase } from '../src/lib/backup.js';
import { rowCounts } from '../src/lib/restore.js';
import { databaseName } from '../src/routes/restore-endpoint.js';
import type { AppConfig } from '../src/config.js';

const TOKEN = 'r'.repeat(20) + crypto.randomBytes(16).toString('hex'); // 52 chars
const open: Knex[] = [];
const fresh = async () => { const db = await testDb(); open.push(db); return db; };
beforeEach(() => { process.env.MAINTENANCE_MODE = 'true'; });
afterEach(async () => { delete process.env.MAINTENANCE_MODE; while (open.length) await open.pop()!.destroy(); });

const mkApp = (db: Knex, o: Partial<AppConfig> = {}) => createApp(db, { cookieSecure: false, restoreToken: TOKEN, restoreRateLimit: 1000, ...o }).app;
const post = (app: any, qs = '', body?: Buffer | string, token: string | null = TOKEN) => {
  let r = request(app).post(`/api/internal/restore${qs}`).set('content-type', 'application/json');
  if (token !== null) r = r.set('authorization', `Bearer ${token}`);
  return body === undefined ? r : r.send(typeof body === 'string' ? body : body.toString('utf8'));
};
const backupOf = async (db: Knex) => JSON.stringify((await dumpDatabase(db)).dump);
const appTables = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([t]) => !t.startsWith('knex_')));

describe('POST /api/internal/restore: gates', () => {
  it('is 404 when RESTORE_TOKEN is unset, too short, or the same as BACKUP_TOKEN', async () => {
    const db = await fresh();
    for (const o of [{ restoreToken: null }, { restoreToken: 'x'.repeat(31) }, { restoreToken: TOKEN, backupToken: TOKEN }]) {
      const app = mkApp(db, o);
      expect((await post(app, '?preflight=1').send('')).status).toBe(404);
      expect((await post(app, '', '{}', 'x'.repeat(31))).status).toBe(404);
    }
    expect((await post(mkApp(db, { restoreToken: 'y'.repeat(32) }), '?preflight=1', '', 'y'.repeat(32))).status).toBe(200); // exactly 32 is enough
  });

  it('is 401 on a missing or wrong token (and the wrong token is not a prefix match)', async () => {
    const app = mkApp(await fresh());
    expect((await post(app, '?preflight=1', '', null)).status).toBe(401);
    expect((await post(app, '?preflight=1', '', TOKEN.slice(0, -1))).status).toBe(401);
    expect((await post(app, '?preflight=1', '', TOKEN + 'x')).status).toBe(401);
    expect((await request(app).post('/api/internal/restore?preflight=1').set('authorization', `Basic ${TOKEN}`).send('')).status).toBe(401);
  });

  it('is 423 while maintenance mode is off, and works once it is on', async () => {
    const db = await fresh();
    const app = mkApp(db);
    delete process.env.MAINTENANCE_MODE;
    const r = await post(app, '?preflight=1', '');
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('maintenance_off');
    process.env.MAINTENANCE_MODE = 'true';
    const ok = await post(app, '?preflight=1', '');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, empty: true, database: await databaseName(db), maintenance: true });
    expect(await rowCounts(db)).toEqual(Object.fromEntries(Object.keys(await rowCounts(db)).map((t) => [t, 0]))); // the gates wrote nothing into an empty target
  });

  it('is rate-limited', async () => {
    const app = mkApp(await fresh(), { restoreRateLimit: 3 });
    for (let i = 0; i < 3; i++) expect((await post(app, '?preflight=1', '', 'bad'.repeat(11))).status).toBe(401);
    expect((await post(app, '?preflight=1', '')).status).toBe(429);
  });
});

describe('POST /api/internal/restore: restoring', () => {
  it('round-trips every table, media bytes and sequences into an empty database, and audit-logs it', async () => {
    const src = await fresh();
    const { media } = await seed(src);
    const body = await backupOf(src);
    const dst = await fresh();
    const app = mkApp(dst);
    const r = await post(app, '', body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ ok: true, dryRun: false, developers: 1, developersAfter: 1, empty: true });
    expect(JSON.stringify(r.body)).not.toContain('password_hash');
    const want = appTables(await rowCounts(src));
    const got = await rowCounts(dst);
    expect({ ...got, audit_logs: got.audit_logs - 1 }).toEqual(want); // + restore.completed
    expect(r.body.counts).toEqual(want);
    for (const m of media) {
      const a = await src('media').where({ id: m.id }).first();
      const b = await dst('media').where({ id: m.id }).first();
      expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data))).toBe(0);
    }
    const last = await dst('audit_logs').orderBy('id', 'desc').first();
    expect(last).toMatchObject({ action: 'restore.completed', actor_username: 'restore-endpoint' });
    expect(JSON.parse(last.details)).toMatchObject({ rows: Object.values(want).reduce((a, b) => a + b, 0), developers: 1, force: false });
    const maxUser = Number((await dst('users').max({ m: 'id' }).first())!.m);
    expect(await insertId(dst('users').insert({ username: 'n', username_lower: 'n', password_hash: 'x', role: 'PLAYER', display_name: 'n' }))).toBeGreaterThan(maxUser);
    expect((await dst('users').where({ role: 'DEVELOPER' }).first()).username).toBe('u0');
  });

  it('dry-run validates and returns counts only, writing nothing', async () => {
    const src = await fresh();
    await seed(src);
    const dst = await fresh();
    const r = await post(mkApp(dst), '?dryRun=1', await backupOf(src));
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.counts).toEqual(appTables(await rowCounts(src)));
    expect(Object.values(await rowCounts(dst)).every((n) => n === 0)).toBe(true);
  });

  it('refuses a non-empty database without force + the exact database name, then replaces it with both', async () => {
    const src = await fresh();
    await seed(src);
    const body = await backupOf(src);
    const dst = await fresh();
    await insertId(dst('users').insert({ username: 'keep', username_lower: 'keep', password_hash: 'x', role: 'PLAYER', display_name: 'k' }));
    const app = mkApp(dst);
    const name = await databaseName(dst);
    const a = await post(app, '', body);
    expect(a.status).toBe(409);
    expect(a.body.code).toBe('not_empty');
    const b = await post(app, `?force=1&confirm=${encodeURIComponent(name + 'x')}`, body);
    expect(b.status).toBe(409);
    expect(b.body.code).toBe('confirm_mismatch');
    const c = await post(app, `?confirm=${encodeURIComponent(name)}`, body);
    expect(c.status).toBe(409); // name without force is not enough
    expect(await dst('users').pluck('username')).toEqual(['keep']);
    expect((await dst('audit_logs').pluck('action')).filter((x: string) => x === 'restore.denied').length).toBe(3); // non-empty DB: denials are audit-logged
    const d = await post(app, `?force=1&confirm=${encodeURIComponent(name)}`, body);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.wiped.find((w: any) => w.table === 'users').rows).toBe(1);
    expect(await dst('users').where({ username: 'keep' }).first()).toBeUndefined();
    expect((await dst('users').where({ role: 'DEVELOPER' }).first()).username).toBe('u0');
  });

  it('rejects a corrupt backup (bad media checksum, bad JSON, truncated, no users) and changes nothing', async () => {
    const src = await fresh();
    await seed(src);
    const dump = (await dumpDatabase(src)).dump as any;
    const dst = await fresh();
    const app = mkApp(dst);
    const bad = JSON.parse(JSON.stringify(dump));
    bad.tables.media[0].sha256 = '0'.repeat(64);
    const full = JSON.stringify(dump);
    const noUsers = JSON.parse(full); delete noUsers.tables.users;
    for (const body of [JSON.stringify(bad), full.slice(0, Math.floor(full.length / 2)), '{"source":"sqlite","tables":{"users":[1]}}', JSON.stringify(noUsers), 'not json']) {
      const r = await post(app, '', body);
      expect(r.status, body.slice(0, 40) + JSON.stringify(r.body)).toBe(400);
      expect(r.body.code).toBe('bad_backup');
      expect(JSON.stringify(r.body)).not.toContain('$base64');
    }
    expect(Object.values(await rowCounts(dst)).every((n) => n === 0)).toBe(true);
  });

  it('rejects an upload over RESTORE_MAX_BYTES with 413', async () => {
    const src = await fresh();
    await seed(src);
    const r = await post(mkApp(await fresh(), { restoreMaxBytes: 10_000 }), '', await backupOf(src));
    expect(r.status).toBe(413);
  });
});
