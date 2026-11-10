import knexFactory, { type Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import pg from 'pg';
import * as m001 from './migrations/001_init.js';
import * as m002 from './migrations/002_stage2.js';
import * as m003 from './migrations/003_optional_email.js';
import * as m004 from './migrations/004_game_flights.js';
import * as m005 from './migrations/005_website.js';
import * as m006 from './migrations/006_sky_crew_outfits.js';
import * as m007 from './migrations/007_sky_crew_economy.js';

/** Migrations are registered in code so they run the same under tsx, tests and builds. */
const MIGRATIONS: Record<string, { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void>; config?: { transaction?: boolean } }> = {
  '001_init': m001,
  '002_stage2': m002,
  '003_optional_email': m003,
  '004_game_flights': m004,
  '005_website': m005,
  '006_sky_crew_outfits': m006,
  '007_sky_crew_economy': m007,
};

const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(MIGRATIONS).sort(),
  getMigrationName: (m) => m,
  getMigration: async (m) => MIGRATIONS[m],
};

/**
 * Make Postgres hand back the same JS values SQLite does, so routes behave identically:
 * timestamps as ISO-8601 strings, dates as 'YYYY-MM-DD', and COUNT()/bigint as numbers.
 */
let pgTypesSet = false;
function pgTypesLikeSqlite() {
  if (pgTypesSet) return;
  pgTypesSet = true;
  const iso = (v: string) => new Date(v).toISOString();
  pg.types.setTypeParser(1184, iso); // timestamptz
  pg.types.setTypeParser(1114, (v: string) => iso(v + 'Z')); // timestamp (stored as UTC)
  pg.types.setTypeParser(1082, (v: string) => v); // date
  pg.types.setTypeParser(20, (v: string) => Number(v)); // int8: counts and bigint ids stay well below 2^53
}

export const isPostgresUrl = (t: string) => /^postgres(ql)?:\/\//i.test(t);

/**
 * Opens the database. `target` is either a Postgres connection URL (production, e.g. Render's
 * DATABASE_URL) or a SQLite file path / ':memory:' (local dev and the default test run).
 * `schema` (Postgres only) isolates a test run in its own schema.
 */
export function createDb(target: string, opts: { schema?: string } = {}): Knex {
  if (isPostgresUrl(target)) {
    pgTypesLikeSqlite();
    const url = new URL(target);
    // TLS: Render's *internal* URL (host like "dpg-xxxx-a", no dots) needs none; its *external* URL
    // (dpg-xxxx-a.frankfurt-postgres.render.com) and most hosted DBs require it. DATABASE_SSL=true|false overrides.
    const mode = url.searchParams.get('sslmode') ?? '';
    const localHost = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/.test(url.hostname) || !url.hostname.includes('.');
    const wantSsl = process.env.DATABASE_SSL ? process.env.DATABASE_SSL === 'true' : mode ? mode !== 'disable' : !localHost;
    return knexFactory({
      client: 'pg',
      connection: { connectionString: target, ssl: wantSsl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 15000 },
      acquireConnectionTimeout: 20000,
      searchPath: opts.schema ? [opts.schema] : undefined,
      pool: { min: 0, max: Number(process.env.DATABASE_POOL_MAX ?? 5) },
    });
  }
  const filename = target;
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = knexFactory({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
        conn.pragma('foreign_keys = ON');
        if (filename !== ':memory:') conn.pragma('journal_mode = WAL');
        done(null, conn);
      },
      ...(filename === ':memory:' ? { min: 1, max: 1 } : {}),
    },
  });
  return db;
}

/** Inserts one row and returns its numeric id on both SQLite and Postgres. */
export async function insertId(q: Knex.QueryBuilder): Promise<number> {
  const rows: any[] = await q.returning('id');
  const v = rows[0];
  return Number(v && typeof v === 'object' ? v.id : v);
}

export async function migrate(db: Knex): Promise<void> {
  await db.migrate.latest({ migrationSource });
}
