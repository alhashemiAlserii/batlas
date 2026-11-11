import type { Knex } from 'knex';
import crypto from 'node:crypto';
import type { DatabaseDump } from './backup.js';

/**
 * Restores a dump made by dumpDatabase() (`npm run backup` or GET /api/internal/backup) into a
 * database that is already migrated to the latest schema. Works on Postgres and SQLite.
 *
 *  - Knex's own bookkeeping tables are never restored (the target's migrations are authoritative).
 *  - Rows go in foreign-key-safe order (parents first), all inside ONE transaction: any error
 *    rolls everything back and the target is left exactly as it was.
 *  - `{"$base64": "..."}` values (uploaded media) become Buffers again (bytea / blob); media rows
 *    are checked against their stored size and sha256 before anything is written.
 *  - Postgres serial sequences are moved to max(id) afterwards, so the next insert gets a fresh id.
 *
 * Nothing here logs row contents: dumps contain password hashes and user data.
 */

export const SKIP_TABLES = new Set(['knex_migrations', 'knex_migrations_lock']);

export class RestoreError extends Error {}

const isPg = (db: Knex) => String(db.client.config.client).includes('pg');
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Checks the overall shape of a parsed dump file; throws RestoreError with a short reason. */
export function parseDump(input: unknown): DatabaseDump {
  const d = input as DatabaseDump;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new RestoreError('not a backup file: expected a JSON object');
  if (!d.tables || typeof d.tables !== 'object' || Array.isArray(d.tables)) throw new RestoreError('not a backup file: missing "tables" object');
  if (d.source !== 'postgres' && d.source !== 'sqlite') throw new RestoreError('not a backup file: "source" must be postgres or sqlite');
  for (const [t, rows] of Object.entries(d.tables)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(t)) throw new RestoreError(`bad table name in backup: ${JSON.stringify(t).slice(0, 60)}`);
    if (!Array.isArray(rows)) throw new RestoreError(`table ${t}: rows must be an array`);
    rows.forEach((r, i) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new RestoreError(`table ${t}: row ${i} is not an object`);
    });
  }
  if (!Array.isArray(d.tables.users)) throw new RestoreError('not a Batlas backup: no users table');
  return d;
}

/** Row counts per table in the dump (Knex bookkeeping tables excluded). */
export function dumpCounts(d: DatabaseDump): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, rows] of Object.entries(d.tables)) if (!SKIP_TABLES.has(t)) out[t] = rows.length;
  return out;
}

export async function listTables(db: Knex | Knex.Transaction): Promise<string[]> {
  const rows = isPg(db as Knex)
    ? (await db.raw(`select table_name as n from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'`)).rows
    : await db.raw(`select name as n from sqlite_master where type = 'table' and name not like 'sqlite_%'`);
  return rows.map((r: any) => r.n).filter((n: string) => !SKIP_TABLES.has(n)).sort();
}

async function columns(db: Knex | Knex.Transaction, table: string): Promise<Map<string, string>> {
  const rows = isPg(db as Knex)
    ? (await db.raw(`select column_name as n, data_type as t from information_schema.columns where table_schema = current_schema() and table_name = ?`, [table])).rows
    : await db.raw(`select name as n, type as t from pragma_table_info(?)`, [table]);
  return new Map(rows.map((r: any) => [r.n, String(r.t).toLowerCase()]));
}

/** child -> parents it references (self-references ignored). */
async function foreignKeys(db: Knex | Knex.Transaction, tables: string[]): Promise<Map<string, Set<string>>> {
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  if (isPg(db as Knex)) {
    const r = await db.raw(`
      select cl.relname as child, pl.relname as parent
        from pg_constraint c
        join pg_class cl on cl.oid = c.conrelid
        join pg_class pl on pl.oid = c.confrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where c.contype = 'f' and n.nspname = current_schema()`);
    for (const { child, parent } of r.rows) if (child !== parent) deps.get(child)?.add(parent);
  } else {
    for (const t of tables) {
      const r = await db.raw(`select "table" as parent from pragma_foreign_key_list(?)`, [t]);
      for (const { parent } of r) if (parent !== t) deps.get(t)?.add(parent);
    }
  }
  return deps;
}

/** Parents before children; ties alphabetical so the order is stable. */
export function topoOrder(deps: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (t: string, path: string[]) => {
    if (state.get(t) === 2) return;
    if (state.get(t) === 1) throw new RestoreError(`foreign-key cycle: ${[...path, t].join(' -> ')}`);
    state.set(t, 1);
    for (const p of [...(deps.get(t) ?? [])].sort()) if (deps.has(p)) visit(p, [...path, t]);
    state.set(t, 2);
    out.push(t);
  };
  for (const t of [...deps.keys()].sort()) visit(t, []);
  return out;
}

export async function rowCounts(db: Knex | Knex.Transaction, tables?: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables ?? (await listTables(db))) out[t] = Number((await db(t).count({ n: '*' }).first())!.n);
  return out;
}

/** Tables in the target that already hold rows. Empty array = safe to restore without --force. */
export async function nonEmptyTables(db: Knex): Promise<{ table: string; rows: number }[]> {
  const c = await rowCounts(db);
  return Object.entries(c).filter(([, n]) => n > 0).map(([table, rows]) => ({ table, rows }));
}

const isBase64Box = (v: unknown): v is { $base64: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as any).$base64 === 'string' && Object.keys(v as object).length === 1;

function convert(value: unknown, colType: string, where: string): unknown {
  if (isBase64Box(value)) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value.$base64)) throw new RestoreError(`${where}: invalid base64`);
    return Buffer.from(value.$base64, 'base64');
  }
  if (value !== null && typeof value === 'object') {
    // json/jsonb columns take objects as-is on Postgres; anything else is stored as JSON text.
    if (colType === 'json' || colType === 'jsonb') return JSON.stringify(value);
    if (/text|char|clob/.test(colType)) return JSON.stringify(value);
    throw new RestoreError(`${where}: unexpected object value for a ${colType || 'untyped'} column`);
  }
  return value;
}

export interface RestoreResult {
  order: string[];
  restored: Record<string, number>;
  /** table -> value the Postgres sequence now points at (empty on SQLite). */
  sequences: Record<string, number>;
  /** tables in the target that the backup does not mention (left empty). */
  notInBackup: string[];
  wiped: { table: string; rows: number }[];
}

/**
 * Restores `dump` into `db` (already migrated). Refuses a non-empty target unless `force`
 * (then every app table is emptied first, inside the same transaction).
 */
export async function restoreDump(db: Knex, dump: DatabaseDump, opts: { force?: boolean } = {}): Promise<RestoreResult> {
  parseDump(dump);
  const existing = await nonEmptyTables(db);
  if (existing.length && !opts.force) {
    throw new RestoreError(`target database is not empty (${existing.map((e) => `${e.table}: ${e.rows}`).join(', ')}); refusing without --force`);
  }
  const pg = isPg(db);
  return db.transaction(async (trx) => {
    const tables = await listTables(trx);
    const order = topoOrder(await foreignKeys(trx, tables));
    const inDump = Object.keys(dump.tables).filter((t) => !SKIP_TABLES.has(t));
    const unknown = inDump.filter((t) => !tables.includes(t));
    if (unknown.length) throw new RestoreError(`backup has tables the target schema does not: ${unknown.join(', ')} (run migrations / use a newer app version)`);

    // Validate + convert everything before writing a single row.
    const prepared = new Map<string, Record<string, unknown>[]>();
    for (const t of order) {
      const rows = dump.tables[t];
      if (!rows) continue;
      const cols = await columns(trx, t);
      prepared.set(t, rows.map((r: any, i) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (!cols.has(k)) throw new RestoreError(`table ${t} row ${i}: column "${k}" does not exist in the target schema`);
          out[k] = convert(v, cols.get(k)!, `table ${t} row ${i} column ${k}`);
        }
        if (t === 'media' && Buffer.isBuffer(out.data)) {
          if (out.size != null && Number(out.size) !== out.data.length) throw new RestoreError(`table media row ${i}: data is ${out.data.length} bytes but size says ${out.size}`);
          if (out.sha256 && crypto.createHash('sha256').update(out.data).digest('hex') !== out.sha256) throw new RestoreError(`table media row ${i}: sha256 mismatch (corrupt media)`);
        }
        return out;
      }));
    }

    const wiped = opts.force ? (await nonEmptyTables(trx as unknown as Knex)) : [];
    if (opts.force) {
      for (const t of [...order].reverse()) await trx(t).del();
      if (!pg && (await trx.raw(`select 1 from sqlite_master where name = 'sqlite_sequence'`)).length) {
        await trx('sqlite_sequence').whereIn('name', order).del();
      }
    }

    const restored: Record<string, number> = {};
    for (const t of order) {
      const rows = prepared.get(t);
      if (!rows) continue;
      restored[t] = 0;
      if (!rows.length) continue;
      const width = Math.max(1, Object.keys(rows[0]).length);
      const hasBlob = rows.some((r) => Object.values(r).some((v) => Buffer.isBuffer(v)));
      const size = hasBlob ? 1 : Math.max(1, Math.floor(5000 / width));
      for (let i = 0; i < rows.length; i += size) {
        await trx(t).insert(rows.slice(i, i + size));
      }
      restored[t] = rows.length;
    }

    const sequences: Record<string, number> = {};
    if (pg) {
      for (const t of order) {
        const cols = await columns(trx, t);
        if (!cols.has('id')) continue;
        const qualified = `${q((await trx.raw('select current_schema() as s')).rows[0].s)}.${q(t)}`;
        const seq = (await trx.raw(`select pg_get_serial_sequence(?, 'id') as s`, [qualified])).rows[0]?.s;
        if (!seq) continue;
        const r = await trx.raw(`select setval(?::regclass, coalesce((select max(id) from ${q(t)}), 1), (select max(id) from ${q(t)}) is not null) as v`, [seq]);
        sequences[t] = Number(r.rows[0].v);
      }
    }

    // Final in-transaction check: what is in the DB now equals what the file says.
    const now = await rowCounts(trx, order);
    for (const [t, n] of Object.entries(restored)) {
      if (now[t] !== n) throw new RestoreError(`table ${t}: expected ${n} rows after restore, found ${now[t]}`);
    }
    return { order, restored, sequences, notInBackup: order.filter((t) => !(t in dump.tables)), wiped };
  });
}

/** Database name the operator must type to confirm a --force restore. */
export function targetName(target: string): string {
  if (/^postgres(ql)?:\/\//i.test(target)) return decodeURIComponent(new URL(target).pathname.replace(/^\//, '')) || 'postgres';
  return target === ':memory:' ? ':memory:' : target.split(/[\\/]/).pop()!;
}

/** host:port/db for Postgres (never the user or password), or the file path for SQLite. */
export function describeTarget(target: string): string {
  if (!/^postgres(ql)?:\/\//i.test(target)) return `sqlite ${target}`;
  const u = new URL(target);
  return `postgres ${u.hostname}${u.port ? ':' + u.port : ''}/${targetName(target)}`;
}

export const isLocalTarget = (target: string) =>
  !/^postgres(ql)?:\/\//i.test(target) || /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/.test(new URL(target).hostname);
