import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Knex } from 'knex';
import { testDb } from './helpers.js';
import { seed, iso } from './restore-seed.js';
import { createDb, insertId, migrate } from '../src/db/index.js';
import { dumpDatabase } from '../src/lib/backup.js';
import { BLOB_CHUNK, restoreDump, parseDump, rowCounts, RestoreError, topoOrder, targetName, describeTarget, isLocalTarget } from '../src/lib/restore.js';
import { SERVER_ROOT } from '../src/config.js';

const open: Knex[] = [];
const fresh = async () => { const db = await testDb(); open.push(db); return db; };
afterEach(async () => { while (open.length) await open.pop()!.destroy(); });

/** Dump as it looks after being written to and read back from a JSON file. */
const asFile = async (db: Knex) => JSON.parse(JSON.stringify((await dumpDatabase(db)).dump));
const appTables = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).filter(([t]) => !t.startsWith('knex_')));

describe('restore (backup -> restore round trip)', () => {
  it('restores every table with identical counts, identical media bytes and working sequences', async () => {
    const src = await fresh();
    const { media } = await seed(src);
    const dump = await asFile(src);
    expect(dump.tables.media[0].data.$base64).toBeTruthy();
    const dst = await fresh();
    const r = await restoreDump(dst, dump);
    const want = appTables(await rowCounts(src));
    expect(await rowCounts(dst)).toEqual(want);
    expect(Object.values(want).every((n) => n > 0)).toBe(true); // seed touches every table
    expect(r.order.indexOf('users')).toBeLessThan(r.order.indexOf('sessions'));
    expect(r.order.indexOf('games')).toBeLessThan(r.order.indexOf('media'));
    for (const m of media) {
      const a = await src('media').where({ id: m.id }).first();
      const b = await dst('media').where({ id: m.id }).first();
      expect(Buffer.isBuffer(b.data)).toBe(true);
      expect(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data))).toBe(0);
      expect(b.sha256).toBe(crypto.createHash('sha256').update(b.data).digest('hex'));
    }
    const norm = (rows: any[]) => rows.map((x) => ({ ...x, banned: Boolean(x.banned), must_change_password: Boolean(x.must_change_password) }));
    expect(norm(await dst('users').orderBy('id'))).toEqual(norm(await src('users').orderBy('id')));
    expect(await dst('audit_logs').orderBy('id').select('id', 'action', 'created_at')).toEqual(await src('audit_logs').orderBy('id').select('id', 'action', 'created_at'));
    expect((await dst('users').where({ role: 'DEVELOPER' }).first()).username).toBe('u0');
    for (const t of ['users', 'audit_logs', 'media', 'games', 'site_events']) {
      const max = Number((await dst(t).max({ m: 'id' }).first())!.m);
      const row: any = t === 'users' ? { username: 'new1', username_lower: 'new1', password_hash: 'x', role: 'PLAYER', display_name: 'n' }
        : t === 'audit_logs' ? { action: 'after.restore', category: 'admin' }
        : t === 'games' ? { slug: 'g2', title: 'G2' }
        : t === 'site_events' ? { title: 'x', announce_at: iso(1), starts_at: iso(1), ends_at: iso(2) }
        : { kind: 'image', content_type: 'image/png', size: 1, sha256: 'x', data: Buffer.from([1]) };
      expect(await insertId(dst(t).insert(row))).toBeGreaterThan(max);
    }
    if (String(dst.client.config.client).includes('pg')) expect(r.sequences.users).toBe(Number((await src('users').max({ m: 'id' }).first())!.m));
  });

  it('refuses a non-empty target without force, and replaces it with force', async () => {
    const src = await fresh();
    await seed(src);
    const dump = await asFile(src);
    const dst = await fresh();
    await insertId(dst('users').insert({ username: 'other', username_lower: 'other', password_hash: 'x', role: 'PLAYER', display_name: 'o' }));
    await expect(restoreDump(dst, dump)).rejects.toThrow(/not empty/);
    expect(await dst('users').pluck('username')).toEqual(['other']);
    const r = await restoreDump(dst, dump, { force: true });
    expect(r.wiped).toEqual([{ table: 'users', rows: 1 }]);
    expect(await rowCounts(dst)).toEqual(appTables(await rowCounts(src)));
    expect(await dst('users').where({ username: 'other' }).first()).toBeUndefined();
  });

  it('rolls back everything when the file fails half-way (FK violation, even with force)', async () => {
    const src = await fresh();
    await seed(src);
    const dump = await asFile(src);
    dump.tables.sessions.push({ id_hash: 'orphan', user_id: 999999, created_at: iso(1), expires_at: iso(2) });
    const dst = await fresh();
    await insertId(dst('users').insert({ username: 'keepme', username_lower: 'keepme', password_hash: 'x', role: 'PLAYER', display_name: 'k' }));
    const before = await rowCounts(dst);
    await expect(restoreDump(dst, dump, { force: true })).rejects.toThrow();
    expect(await rowCounts(dst)).toEqual(before);
    expect(await dst('users').pluck('username')).toEqual(['keepme']);
  });

  it('rejects bad files before writing: unknown table/column, corrupt media, bad base64, junk', async () => {
    const src = await fresh();
    await seed(src);
    const good = await asFile(src);
    const dst = await fresh();
    const variants: [(d: any) => void, RegExp][] = [
      [(d) => { d.tables.bogus = [{ a: 1 }]; }, /tables the target schema does not/],
      [(d) => { d.tables.users[0].hacked = 1; }, /column "hacked"/],
      [(d) => { const b = Buffer.from(d.tables.media[0].data.$base64, 'base64'); b[20] ^= 0xff; d.tables.media[0].data.$base64 = b.toString('base64'); }, /sha256 mismatch/],
      [(d) => { d.tables.media[0].size = 1; }, /size says/],
      [(d) => { d.tables.media[0].data.$base64 = '***'; }, /invalid base64/],
    ];
    for (const [mutate, re] of variants) {
      const d = structuredClone(good);
      mutate(d);
      await expect(restoreDump(dst, d)).rejects.toThrow(re);
      expect(Object.values(await rowCounts(dst)).every((n) => n === 0)).toBe(true);
    }
    for (const junk of [null, [], {}, { tables: [] }, { source: 'mysql', tables: {} }, { source: 'postgres', tables: { users: 'x' } }, { source: 'postgres', tables: { nope: [] } }]) {
      expect(() => parseDump(junk)).toThrow(RestoreError);
    }
  });

  it('restores an old (pre-005, no media) dump into the current schema', async () => {
    const src = await fresh();
    await seed(src);
    const dump = await asFile(src);
    for (const t of ['media', 'site_settings', 'site_events']) delete dump.tables[t];
    for (const u of dump.tables.users) delete u.last_seen_at;
    for (const n of dump.tables.news_posts) delete n.game_id;
    const dst = await fresh();
    const r = await restoreDump(dst, dump);
    expect(r.notInBackup.sort()).toEqual(['media', 'site_events', 'site_settings']);
    expect(Number((await dst('users').count({ n: '*' }).first())!.n)).toBe(dump.tables.users.length);
  });

  it('helpers: FK topo order; target name/description never include credentials', () => {
    expect(topoOrder(new Map([['c', new Set(['b'])], ['b', new Set(['a'])], ['a', new Set<string>()]]))).toEqual(['a', 'b', 'c']);
    expect(() => topoOrder(new Map([['a', new Set(['b'])], ['b', new Set(['a'])]]))).toThrow(/cycle/);
    const url = 'postgres://user:s3cret@db.example.com:5432/batlas_new?sslmode=require';
    expect(targetName(url)).toBe('batlas_new');
    expect(describeTarget(url)).toBe('postgres db.example.com:5432/batlas_new');
    expect(isLocalTarget(url)).toBe(false);
    expect(isLocalTarget('postgres://a:b@127.0.0.1:5433/x')).toBe(true);
    expect(targetName('/tmp/x/studio.sqlite')).toBe('studio.sqlite');
  });
});

describe('npm run restore (CLI, SQLite file target)', () => {
  const tsx = path.join(SERVER_ROOT, 'node_modules', '.bin', 'tsx');
  const run = (args: string[], dbFile: string) => spawnSync(tsx, ['src/cli/restore.ts', ...args], {
    cwd: SERVER_ROOT, encoding: 'utf8', input: '',
    env: { ...process.env, DATABASE_URL: '', DB_FILE: dbFile },
  });

  it('dry-run leaves the target alone; refuses non-empty; --force needs the typed name; never prints row data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-cli-'));
    const src = createDb(':memory:'); await migrate(src); await seed(src);
    const file = path.join(dir, 'b.json');
    fs.writeFileSync(file, JSON.stringify((await dumpDatabase(src)).dump));
    await src.destroy();
    const dbFile = path.join(dir, 'target.sqlite');

    const dry = run(['--file', file, '--dry-run'], dbFile);
    expect(dry.stdout).toMatch(/Dry run OK/);
    expect(dry.status).toBe(0);
    expect(fs.existsSync(dbFile)).toBe(false);

    const first = run(['--file', file], dbFile);
    expect(first.stdout + first.stderr).toMatch(/Restore OK/);
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/media\s+2\s+2/);
    for (const out of [dry.stdout, first.stdout]) expect(out).not.toMatch(/U0|password_hash|\$base64|shot\.png|n@x\.dev/);

    const again = run(['--file', file], dbFile);
    expect(again.status).toBe(3);
    expect(again.stderr).toMatch(/not empty/);
    expect(run(['--file', file, '--force', '--confirm', 'nope'], dbFile).status).toBe(3);
    expect(run(['--file', file, '--force'], dbFile).status).toBe(3);
    const ok = run(['--file', file, '--force', '--confirm', 'target.sqlite'], dbFile);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/Replaced existing rows/);

    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
    const bad = run(['--file', path.join(dir, 'bad.json')], dbFile);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/not valid JSON/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 60000);
});

describe('restore: large media', () => {
  it('writes a media file bigger than BLOB_CHUNK intact (Postgres appends it in pieces)', async () => {
    const src = await fresh();
    await seed(src);
    const big = crypto.randomBytes(BLOB_CHUNK * 2 + 12345);
    const sha = crypto.createHash('sha256').update(big).digest('hex');
    const id = await insertId(src('media').insert({ kind: 'video', content_type: 'video/mp4', size: big.length, sha256: sha, data: big, created_at: iso(50) }));
    const dst = await fresh();
    await restoreDump(dst, await asFile(src));
    const row = await dst('media').where({ id }).first();
    expect(Buffer.from(row.data).length).toBe(big.length);
    expect(crypto.createHash('sha256').update(row.data).digest('hex')).toBe(sha);
  }, 60_000);
});
