/**
 * Box-side client for POST /api/internal/restore: streams a backup file to the site over HTTPS.
 *
 *   npx tsx scripts/restore-remote.ts --url https://batlas-2je9.onrender.com --file backups/<file>.json --preflight
 *   npx tsx scripts/restore-remote.ts --url ... --file ... --dry-run
 *   npx tsx scripts/restore-remote.ts --url ... --file ...                       # real restore into an EMPTY database
 *   npx tsx scripts/restore-remote.ts --url ... --file ... --force --confirm <db>  # REPLACE a non-empty database
 *
 * The token is read from a file (default server/data/restore-token.txt, gitignored; or
 * --token-file / RESTORE_TOKEN_FILE). It is never printed, never taken on the command line
 * (it would end up in shell history and `ps`), and only sent as an Authorization header.
 * Only counts are printed; the backup's contents never are.
 *
 * Always runs a preflight first (auth + maintenance + is-the-target-empty) and stops before
 * uploading anything if the server would refuse.
 *
 * Exit codes: 0 ok, 1 restore failed, 2 bad arguments / file, 3 refused by the server.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TOKEN_FILE = path.join(SERVER_ROOT, 'data', 'restore-token.txt');

export interface RemoteOptions {
  url: string;
  token: string;
  file?: string;
  mode: 'preflight' | 'dry-run' | 'restore';
  force?: boolean;
  confirm?: string;
  onProgress?: (sent: number, total: number) => void;
  allowHttp?: boolean;
}

export function readTokenFile(file: string): string {
  const st = fs.statSync(file);
  if (process.platform !== 'win32' && (st.mode & 0o077)) console.error(`warning: ${file} is readable by other users; run: chmod 600 ${file}`);
  const t = fs.readFileSync(file, 'utf8').trim();
  if (t.length < 32) throw new Error(`token in ${file} is shorter than 32 characters (the server would answer 404)`);
  if (/\s/.test(t)) throw new Error(`token in ${file} contains whitespace`);
  return t;
}

/** One request to the restore endpoint. Resolves with the HTTP status and JSON body. */
export function restoreRequest(o: RemoteOptions): Promise<{ status: number; body: any }> {
  const base = new URL(o.url);
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(base.hostname);
  if (base.protocol !== 'https:' && !(local || o.allowHttp)) return Promise.reject(new Error('refusing to send the token over plain http to a non-local host; use https://'));
  const u = new URL('/api/internal/restore', base);
  if (o.mode === 'preflight') u.searchParams.set('preflight', '1');
  if (o.mode === 'dry-run') u.searchParams.set('dryRun', '1');
  if (o.force) u.searchParams.set('force', '1');
  if (o.confirm) u.searchParams.set('confirm', o.confirm);
  const total = o.mode === 'preflight' || !o.file ? 0 : fs.statSync(o.file).size;
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json', 'content-length': String(total) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: any;
        try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
        resolve({ status: res.statusCode ?? 0, body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (!total) return req.end();
    let sent = 0;
    const rs = fs.createReadStream(o.file!, { highWaterMark: 1 << 20 });
    rs.on('data', (c) => { sent += c.length; o.onProgress?.(sent, total); });
    rs.on('error', (e) => { req.destroy(e); reject(e); });
    rs.pipe(req);
  });
}

const fmt = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' }, file: { type: 'string' }, 'token-file': { type: 'string' },
      preflight: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false }, confirm: { type: 'string' }, help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.url) {
    console.log('usage: npx tsx scripts/restore-remote.ts --url https://<site> [--file <backup.json>] [--preflight | --dry-run] [--force --confirm <database name>] [--token-file <path>]');
    process.exit(values.help ? 0 : 2);
  }
  const tokenFile = values['token-file'] ?? process.env.RESTORE_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  let token: string;
  try { token = readTokenFile(tokenFile); } catch (e: any) { console.error(`Cannot read the restore token: ${e.message}`); process.exit(2); }
  const mode = values.preflight ? 'preflight' : values['dry-run'] ? 'dry-run' : 'restore';
  if (mode !== 'preflight') {
    if (!values.file) { console.error('--file is required (except with --preflight)'); process.exit(2); }
    if (!fs.existsSync(values.file)) { console.error(`No such file: ${values.file}`); process.exit(2); }
  }
  if (values.force && !values.confirm) { console.error('--force needs --confirm <exact database name>'); process.exit(2); }

  const pre = await restoreRequest({ url: values.url, token, mode: 'preflight' }).catch((e) => { console.error(`Preflight failed: ${e.message}`); process.exit(1); });
  if (pre.status !== 200) {
    console.error(`Preflight refused (HTTP ${pre.status}): ${pre.body?.error ?? ''}${pre.status === 404 ? ' (RESTORE_TOKEN not configured on the server?)' : ''}`);
    process.exit(3);
  }
  const ne = Object.entries(pre.body.nonEmpty ?? {}).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`Target database: ${pre.body.database}  maintenance: on  ${pre.body.empty ? 'EMPTY' : `NOT EMPTY (${ne})`}`);
  if (mode === 'preflight') return;
  if (!pre.body.empty && mode === 'restore' && !values.force) {
    console.error('The target database is not empty. Nothing was sent. To REPLACE it, re-run with --force --confirm <database name>.');
    process.exit(3);
  }
  const size = fs.statSync(values.file!).size;
  if (size > pre.body.maxBytes) { console.error(`The file (${fmt(size)}) is larger than the server's RESTORE_MAX_BYTES (${fmt(pre.body.maxBytes)}).`); process.exit(2); }
  console.log(`${mode === 'dry-run' ? 'Dry run: uploading' : 'Restoring: uploading'} ${fmt(size)} ...`);
  let last = 0;
  const r = await restoreRequest({
    url: values.url, token, file: values.file, mode, force: values.force, confirm: values.confirm,
    onProgress: (s, t) => { const p = Math.floor((s / t) * 10); if (p > last) { last = p; process.stderr.write(`  ${p * 10}%`); } },
  }).catch((e) => { console.error(`\nUpload failed: ${e.message}`); process.exit(1); });
  process.stderr.write('\n');
  if (r.status !== 200) {
    console.error(`Server answered HTTP ${r.status}: ${r.body?.error ?? ''}`);
    process.exit(r.status === 400 || r.status === 413 || r.status >= 500 ? 1 : 3);
  }
  const b = r.body;
  console.log(`${b.dryRun ? 'DRY RUN OK (nothing written)' : 'RESTORED'}: ${b.rows} rows in ${b.tables} tables, ${fmt(b.bytes)} received, ${b.ms} ms`);
  for (const [t, n] of Object.entries(b.counts ?? {})) console.log(`  ${t.padEnd(18)} ${n}`);
  console.log(`  Developers in backup: ${b.developers}${b.developersAfter != null ? `, in database now: ${b.developersAfter}` : ''}`);
  if (b.wiped?.length) console.log(`  Replaced existing rows: ${b.wiped.map((w: any) => `${w.table} ${w.rows}`).join(', ')}`);
  if (b.note) console.log(`  ${b.note}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
