/**
 * Dumps every table to one JSON file.
 *
 *   DATABASE_URL=postgres://... npm run backup [-- --out path/to/file.json]
 *
 * Uses DATABASE_URL (e.g. Render's *external* connection string) or, when unset, the local
 * SQLite file. Default output: ./backups/batlas-<UTC timestamp>.json (chmod 600).
 * The file contains password hashes and emails: keep it private, never commit it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDb, isPostgresUrl } from '../db/index.js';
import { dumpDatabase } from '../lib/backup.js';
import { dbTarget, SERVER_ROOT } from '../config.js';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const target = dbTarget();
const pg = isPostgresUrl(target);
const db = createDb(target);
try {
  const { dump, rows } = await dumpDatabase(db);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(values.out ?? path.join(SERVER_ROOT, 'backups', `batlas-${stamp}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(dump, null, 1), { mode: 0o600 });
  console.log(`Backed up ${Object.keys(dump.tables).length} tables (${rows} rows) from ${pg ? 'postgres' : 'sqlite'} to ${out}`);
} catch (e) {
  console.error('Backup failed:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
