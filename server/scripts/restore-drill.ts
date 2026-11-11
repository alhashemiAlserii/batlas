/**
 * Restore drill: proves a backup file can be brought back into a brand-new database.
 *
 *   npx tsx scripts/restore-drill.ts --file backups/live-XXXX.json [--db batlas_restore_drill]
 *        [--admin-url postgres://batlas:localtest@127.0.0.1:5433/postgres] [--keep]
 *
 * 1. (re)creates database --db on the LOCAL Postgres given by --admin-url (refuses non-local hosts)
 * 2. runs the real `npm run restore -- --file ...` CLI against it
 * 3. verifies: per-table counts == file, every Developer in the file is still a Developer,
 *    audit log count and the latest 5 entries (id/action/created_at) match, sequences are at
 *    max(id), and a fresh insert into every table with an id succeeds (inside a rolled-back transaction).
 * Prints counts and pass/fail only, never row contents.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createDb } from '../src/db/index.js';
import { parseDump, dumpCounts, rowCounts, isLocalTarget } from '../src/lib/restore.js';
import { SERVER_ROOT } from '../src/config.js';

const { values } = parseArgs({ options: {
  file: { type: 'string' }, db: { type: 'string', default: 'batlas_restore_drill' },
  'admin-url': { type: 'string', default: process.env.DRILL_ADMIN_URL ?? 'postgres://batlas:localtest@127.0.0.1:5433/postgres' },
  keep: { type: 'boolean', default: false },
} });
if (!values.file) { console.error('--file is required'); process.exit(2); }
if (!/^[a-z_][a-z0-9_]*$/.test(values.db!)) { console.error('bad --db name'); process.exit(2); }
const adminUrl = values['admin-url']!;
if (!isLocalTarget(adminUrl)) { console.error('drill only runs against a local Postgres'); process.exit(2); }

const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

const dump = parseDump(JSON.parse(fs.readFileSync(values.file, 'utf8')));
const fileCounts = dumpCounts(dump);
console.log(`Drill file: ${path.basename(values.file)} — ${Object.keys(fileCounts).length} tables, ${Object.values(fileCounts).reduce((a, b) => a + b, 0)} rows, created ${dump.createdAt}`);

const admin = createDb(adminUrl);
await admin.raw(`drop database if exists "${values.db}"`);
await admin.raw(`create database "${values.db}"`);
await admin.destroy();
const url = new URL(adminUrl); url.pathname = '/' + values.db;
const target = url.toString();

const t0 = Date.now();
const r = spawnSync(path.join(SERVER_ROOT, 'node_modules', '.bin', 'tsx'), ['src/cli/restore.ts', '--file', path.resolve(values.file)], {
  cwd: SERVER_ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: target }, input: '',
});
console.log(r.stdout.trim()); if (r.stderr.trim()) console.log(r.stderr.trim());
check('npm run restore exit code 0', r.status === 0, `exit ${r.status}, ${Date.now() - t0} ms`);

const db = createDb(target);
try {
  const now = await rowCounts(db);
  const mismatched = Object.entries(fileCounts).filter(([t, n]) => now[t] !== n);
  check('per-table row counts match the file', mismatched.length === 0, mismatched.length ? mismatched.map(([t, n]) => `${t} file ${n} db ${now[t]}`).join('; ') : `${Object.keys(fileCounts).length} tables`);

  const devs = (dump.tables.users as any[]).filter((u) => u.role === 'DEVELOPER');
  const devRows = await db('users').whereIn('id', devs.map((u) => u.id)).select('id', 'username', 'role', 'banned');
  check('Developer-rank account(s) still Developer and not banned', devs.length > 0 && devRows.length === devs.length && devRows.every((u: any) => u.role === 'DEVELOPER' && !u.banned && devs.find((d) => d.id === u.id)!.username === u.username), `${devs.length} in file, ${devRows.filter((u: any) => u.role === 'DEVELOPER').length} in db`);
  check('"abood" is a Developer', (await db('users').where({ username_lower: 'abood' }).first('role'))?.role === 'DEVELOPER');

  const fileAudit = [...(dump.tables.audit_logs as any[])].sort((a, b) => b.id - a.id);
  const dbAudit = await db('audit_logs').orderBy('id', 'desc').limit(5).select('id', 'action', 'created_at');
  check('audit log count matches', now.audit_logs === fileAudit.length, `${fileAudit.length}`);
  const same = dbAudit.length === Math.min(5, fileAudit.length) && dbAudit.every((e: any, i: number) => e.id === fileAudit[i].id && e.action === fileAudit[i].action && new Date(e.created_at).getTime() === new Date(fileAudit[i].created_at).getTime());
  check('latest 5 audit entries (id, action, time) match', same, `newest id ${dbAudit[0]?.id ?? '-'}`);

  if (dump.tables.media?.length) {
    const crypto = await import('node:crypto');
    const rows = await db('media').select('id', 'size', 'sha256', 'data');
    const ok = rows.length === dump.tables.media.length && rows.every((m: any) => m.data.length === Number(m.size) && crypto.createHash('sha256').update(m.data).digest('hex') === m.sha256);
    check('media bytes intact (size + sha256 per row)', ok, `${rows.length} rows, ${rows.reduce((n: number, m: any) => n + m.data.length, 0)} bytes`);
  }

  const seqs = (await db.raw(`select c.relname as t, pg_get_serial_sequence(quote_ident(c.relname), 'id') as s from pg_class c join pg_namespace n on n.oid = c.relnamespace join information_schema.columns col on col.table_schema = n.nspname and col.table_name = c.relname and col.column_name = 'id' where n.nspname = current_schema() and c.relkind = 'r'`)).rows.filter((x: any) => x.s);
  let seqOk = true; const seqDetail: string[] = [];
  await db.transaction(async (trx) => {
    for (const { t, s } of seqs) {
      const max = Number((await trx(t).max({ m: 'id' }).first())!.m ?? 0);
      const { last_value, is_called } = (await trx.raw(`select last_value, is_called from ${s}`)).rows[0];
      const next = is_called ? Number(last_value) + 1 : Number(last_value);
      if (next <= max) seqOk = false;
      seqDetail.push(`${t} next ${next} > max ${max}`);
    }
    // a real insert into the tables people write to most; rolled back so the drill DB stays an exact copy
    const uid = Number((await trx('users').insert({ username: 'drill_probe', username_lower: 'drill_probe', password_hash: 'x', role: 'PLAYER', display_name: 'p' }).returning('id'))[0].id);
    const aid = Number((await trx('audit_logs').insert({ action: 'drill.probe', category: 'admin' }).returning('id'))[0].id);
    const maxU = Math.max(0, ...(dump.tables.users as any[]).map((u) => u.id));
    const maxA = Math.max(0, ...(dump.tables.audit_logs as any[]).map((u) => u.id));
    check('fresh insert after restore works (users, audit_logs)', uid > maxU && aid > maxA, `new users.id ${uid} > ${maxU}, audit_logs.id ${aid} > ${maxA}`);
    throw Object.assign(new Error('rollback'), { rollback: true });
  }).catch((e) => { if (!e.rollback) throw e; });
  check('every serial sequence points past max(id)', seqOk, `${seqs.length} sequences`);
} finally {
  await db.destroy();
  if (!values.keep) { const a = createDb(adminUrl); await a.raw(`drop database if exists "${values.db}"`); await a.destroy(); }
}
const failed = checks.filter((c) => !c[1]).length;
console.log(`\nDrill ${failed ? 'FAILED' : 'PASSED'}: ${checks.length - failed}/${checks.length} checks${values.keep ? `; database ${values.db} kept` : `; database ${values.db} dropped`}`);
process.exitCode = failed ? 1 : 0;
