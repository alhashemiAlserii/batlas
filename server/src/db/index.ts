import knexFactory, { type Knex } from 'knex';
import path from 'node:path';
import fs from 'node:fs';
import * as m001 from './migrations/001_init.js';
import * as m002 from './migrations/002_stage2.js';
import * as m003 from './migrations/003_optional_email.js';

/** Migrations are registered in code so they run the same under tsx, tests and builds. */
const MIGRATIONS: Record<string, { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void>; config?: { transaction?: boolean } }> = {
  '001_init': m001,
  '002_stage2': m002,
  '003_optional_email': m003,
};

const migrationSource: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(MIGRATIONS).sort(),
  getMigrationName: (m) => m,
  getMigration: async (m) => MIGRATIONS[m],
};

export function createDb(filename: string): Knex {
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

export async function migrate(db: Knex): Promise<void> {
  await db.migrate.latest({ migrationSource });
}
