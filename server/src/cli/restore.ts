/**
 * Restores a backup made by `npm run backup` or GET /api/internal/backup.
 *
 *   npm run restore -- --file backups/live-XXXX.json --dry-run
 *   DATABASE_URL=postgres://... npm run restore -- --file backups/live-XXXX.json
 *   DATABASE_URL=postgres://... npm run restore -- --file f.json --force --confirm <database name>
 *
 * Target: DATABASE_URL (Postgres) or, when unset, the local SQLite file (DB_FILE), exactly like the app.
 * Steps: validate the file -> run migrations on the target -> refuse if the target has any rows
 * (unless --force AND the typed database name) -> insert everything in one transaction
 * (all or nothing) -> fix Postgres sequences -> print per-table counts.
 * A target that is not on this machine always needs --confirm <database name>, even when empty.
 * --dry-run never touches the target: it validates the file and test-restores it into a
 * throw-away in-memory SQLite database to prove it would load.
 * Never prints row contents, the connection string or credentials.
 */
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createDb, migrate } from '../db/index.js';
import { dbTarget } from '../config.js';
import { parseDump, dumpCounts, restoreDump, nonEmptyTables, rowCounts, targetName, describeTarget, isLocalTarget, RestoreError, type RestoreResult } from '../lib/restore.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    force: { type: 'boolean', default: false },
    confirm: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

function table(rows: [string, ...(string | number)[]][], head: string[]) {
  const all = [head, ...rows.map((r) => r.map(String))];
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r, j) => r.map((c, i) => (i ? c.padStart(w[i]) : c.padEnd(w[i]))).join('  ') + (j === 0 ? '\n' + w.map((n) => '-'.repeat(n)).join('  ') : '')).join('\n');
}

async function main(): Promise<number> {
  if (values.help || !values.file) {
    console.log('usage: npm run restore -- --file <backup.json> [--dry-run] [--force --confirm <database name>]');
    return values.help ? 0 : 2;
  }
  let dump;
  try {
    dump = parseDump(JSON.parse(fs.readFileSync(values.file, 'utf8')));
  } catch (e) {
    console.error(`Restore refused: ${e instanceof SyntaxError ? 'file is not valid JSON' : (e as Error).message}`);
    return 2;
  }
  const counts = dumpCounts(dump);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Backup: ${Object.keys(counts).length} tables, ${total} rows, source ${dump.source}, created ${dump.createdAt ?? 'unknown'}`);

  if (values['dry-run']) {
    const scratch = createDb(':memory:');
    try {
      await migrate(scratch);
      const r = await restoreDump(scratch, dump);
      console.log(table(Object.entries(counts).map(([t, n]) => [t, n, r.restored[t] ?? 0]), ['table', 'in file', 'test-restored']));
      if (r.notInBackup.length) console.log(`Not in backup (will stay empty): ${r.notInBackup.join(', ')}`);
      console.log('Dry run OK: the file is valid and loads into the current schema. Target database was not touched.');
      return 0;
    } catch (e) {
      console.error(`Dry run FAILED: ${(e as Error).message}`);
      return 1;
    } finally {
      await scratch.destroy();
    }
  }

  const target = dbTarget();
  const name = targetName(target);
  console.log(`Target: ${describeTarget(target)}`);
  const db = createDb(target);
  try {
    await migrate(db);
    const existing = await nonEmptyTables(db);
    const needConfirm = existing.length > 0 || !isLocalTarget(target);
    if (existing.length) {
      console.log(`Target is NOT empty: ${existing.map((e) => `${e.table} ${e.rows}`).join(', ')}`);
      if (!values.force) {
        console.error('Restore refused: target database is not empty. Re-run with --force --confirm <database name> to REPLACE all its data.');
        return 3;
      }
      console.log('--force: every app table in the target will be emptied and replaced by the backup (one transaction).');
    }
    if (needConfirm) {
      let typed = values.confirm;
      if (typed === undefined && process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        typed = (await rl.question(`Type the target database name (${name}) to continue: `)).trim();
        rl.close();
      }
      if (typed !== name) {
        console.error(`Restore refused: confirmation ${typed === undefined ? 'missing' : 'does not match'}; pass --confirm ${name} (or type it at the prompt).`);
        return 3;
      }
    }
    const r: RestoreResult = await restoreDump(db, dump, { force: values.force });
    const after = await rowCounts(db, r.order);
    console.log(table(r.order.map((t) => [t, counts[t] ?? '-', after[t]]), ['table', 'in file', 'in database']));
    if (r.wiped.length) console.log(`Replaced existing rows: ${r.wiped.map((w) => `${w.table} ${w.rows}`).join(', ')}`);
    if (Object.keys(r.sequences).length) console.log(`Sequences set: ${Object.entries(r.sequences).map(([t, v]) => `${t}=${v}`).join(', ')}`);
    const bad = Object.entries(counts).filter(([t, n]) => after[t] !== n);
    if (bad.length) { console.error(`Restore FAILED verification: ${bad.map(([t]) => t).join(', ')}`); return 1; }
    console.log(`Restore OK: ${total} rows in ${Object.keys(counts).length} tables.`);
    return 0;
  } catch (e) {
    console.error(`Restore FAILED (nothing was changed; the transaction was rolled back): ${e instanceof RestoreError ? e.message : (e as Error).message.split('\n')[0].slice(0, 300)}`);
    return 1;
  } finally {
    await db.destroy();
  }
}

process.exitCode = await main();
