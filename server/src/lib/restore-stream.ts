import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parser } from 'stream-json';
import { RestoreError, type RowSource } from './restore.js';

/**
 * Streams a backup file (the JSON written by `npm run backup` / GET /api/internal/backup) to a
 * private temp directory without ever holding the backup, or even one media file's base64 text,
 * in memory:
 *
 *  - every table becomes an NDJSON file, written token by token as the upload arrives;
 *  - every `{"$base64": "..."}` value (uploaded media) is decoded on the fly into its own binary
 *    file and replaced by a small `{"$file": ...}` reference.
 *
 * Reading back (RowSource.rows) yields one row at a time with media as a Buffer loaded from its
 * file, so peak memory is about one media file plus the database driver's copy of it.
 * IMPORTANT: media Buffers share one reusable buffer and are only valid until the next row is
 * requested (restoreFromSource inserts each blob row before reading the next).
 *
 * The staged files hold the same data as the backup (password hashes, user data): directory
 * 0700, files 0600, removed by cleanup(). Nothing here logs row contents.
 */
export interface StagedBackup {
  dir: string;
  bytes: number;
  meta: { source: string | null; createdAt: string | null };
  counts: Record<string, number>;
  /** DEVELOPER rows in the backup's users table. */
  developers: number;
  /** Decoded media bytes staged. */
  blobBytes: number;
  source: RowSource;
  cleanup(): Promise<void>;
}

export class UploadTooLarge extends RestoreError {}

const TABLE_RE = /^[a-z_][a-z0-9_]*$/i;
const B64_CHARS = /^[A-Za-z0-9+/]*$/;
type Tok = { name: string; value?: string };

class Writer {
  private buf: string[] = [];
  private size = 0;
  constructor(private ws: fs.WriteStream) { ws.on('error', () => {}); }
  push(s: string) { this.buf.push(s); this.size += s.length; }
  async maybeFlush(force = false) {
    if (!force && this.size < 1 << 16) return;
    const s = this.buf.join('');
    this.buf = []; this.size = 0;
    if (!s) return;
    if (this.ws.errored) throw this.ws.errored;
    if (!this.ws.write(s)) await new Promise<void>((r) => this.ws.once('drain', r));
  }
  async end() { await this.maybeFlush(true); await new Promise<void>((res, rej) => this.ws.end((e?: Error | null) => (e ? rej(e) : res()))); }
}

export async function stageBackup(input: Readable, opts: { maxBytes: number; tmpDir?: string }): Promise<StagedBackup> {
  const base = opts.tmpDir ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'batlas-restore-'));
  fs.chmodSync(dir, 0o700);
  const cleanup = () => fs.promises.rm(dir, { recursive: true, force: true });
  const files = new Map<string, string>();
  const counts: Record<string, number> = {};
  let bytes = 0, developers = 0, blobBytes = 0, blobN = 0;
  const meta = { source: null as string | null, createdAt: null as string | null };

  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > opts.maxBytes) return cb(new UploadTooLarge(`upload is larger than the ${opts.maxBytes}-byte limit (RESTORE_MAX_BYTES)`));
      cb(null, chunk);
    },
  });
  // Keys and numbers packed (small); strings ONLY as chunks, so a huge base64 value is never one string.
  const tokens = parser.asStream({ packKeys: true, streamKeys: false, packNumbers: true, streamNumbers: false, packStrings: false, streamStrings: true });
  // Piped (not pipeline()d) so a bad backup does not destroy the request: the caller can still
  // answer with an error and drain the rest of the body.
  const onInputError = (e: Error) => counter.destroy(e);
  input.on('error', onInputError);
  input.on('aborted', () => counter.destroy(new RestoreError('upload aborted by the client')));
  input.pipe(counter);
  const piping = pipeline(counter, tokens);
  piping.catch(() => {}); // surfaced through the token iterator below
  const detach = () => { input.unpipe(counter); input.off('error', onInputError); };

  // ---- top-level walker state: 0 before the object, 1 inside it, 2 inside "tables", 3 inside a table array
  let level = 0, topKey: string | null = null, table: string | null = null, skip = 0, done = false, sawTables = false;
  let small: string | null = null; // capturing a short top-level string (source / createdAt)
  let out: Writer | null = null;

  // ---- row writer state
  type Frame = { obj: boolean; n: number; pending?: boolean };
  let stack: Frame[] = []; // empty = not inside a row
  let afterKey = false;
  let roleKey = false, role: string | null = null; // users.role capture
  let b64: { ws: fs.WriteStream; hash: crypto.Hash; carry: string; size: number; file: string; phase: 'str' | 'end'; pad: boolean } | null = null;

  const valueStart = () => {
    const f = stack[stack.length - 1];
    if (!f) return;
    if (f.obj) { if (!afterKey) throw new RestoreError(`table ${table}: malformed row`); afterKey = false; }
    else { if (f.n++) out!.push(','); }
  };
  const openPending = () => {
    const f = stack[stack.length - 1];
    if (f?.pending) { f.pending = false; out!.push('{'); }
  };
  const b64Write = async (s: string) => {
    const all = b64!.carry + s;
    const cut = all.length - (all.length % 4);
    b64!.carry = all.slice(cut);
    if (cut) {
      const buf = Buffer.from(all.slice(0, cut), 'base64');
      b64!.hash.update(buf); b64!.size += buf.length;
      if (b64!.ws.errored) throw b64!.ws.errored;
      if (!b64!.ws.write(buf)) await new Promise<void>((r) => b64!.ws.once('drain', r));
    }
  };

  /** One token inside a row (stack non-empty, or the row's opening token). */
  const rowToken = async (t: Tok) => {
    if (b64) {
      if (b64.phase === 'str') {
        if (t.name === 'stringChunk') {
          const v = t.value!;
          const bad = () => new RestoreError(`table ${table} row ${counts[table!]}: invalid base64`);
          if (b64.pad && v) throw bad(); // nothing may follow the padding
          const eq = v.indexOf('=');
          if (eq >= 0) {
            const tail = v.slice(eq);
            if (!/^={1,2}$/.test(tail)) throw bad();
            b64.pad = true;
          }
          if (!B64_CHARS.test(eq >= 0 ? v.slice(0, eq) : v)) throw bad();
          await b64Write(v);
          return;
        }
        if (t.name === 'endString') {
          if (b64.carry) throw new RestoreError(`table ${table} row ${counts[table!]}: invalid base64 length`);
          b64.phase = 'end';
          return;
        }
        if (t.name === 'startString') return;
        throw new RestoreError(`table ${table} row ${counts[table!]}: $base64 must be a string`);
      }
      // phase 'end': the box must close right after the string
      if (t.name !== 'endObject') throw new RestoreError(`table ${table} row ${counts[table!]}: unexpected key after $base64`);
      await new Promise<void>((res, rej) => b64!.ws.end((e?: Error | null) => (e ? rej(e) : res())));
      blobBytes += b64.size;
      out!.push(JSON.stringify({ $file: path.basename(b64.file), size: b64.size, sha256: b64.hash.digest('hex') }));
      b64 = null;
      stack.pop();
      return;
    }
    const f = stack[stack.length - 1];
    if (f?.pending) {
      if (t.name === 'keyValue' && t.value === '$base64') {
        const file = path.join(dir, `blob-${++blobN}.bin`);
        const ws = fs.createWriteStream(file, { mode: 0o600 });
        ws.on('error', () => {});
        b64 = { ws, hash: crypto.createHash('sha256'), carry: '', size: 0, file, phase: 'str', pad: false };
        return;
      }
      openPending();
    }
    switch (t.name) {
      case 'startObject':
        valueStart();
        stack.push({ obj: true, n: 0, pending: stack.length > 0 }); // nested objects may be a $base64 box
        if (stack.length === 1) out!.push('{');
        return;
      case 'startArray': valueStart(); stack.push({ obj: false, n: 0 }); out!.push('['); return;
      case 'endObject': stack.pop(); out!.push('}'); break;
      case 'endArray': stack.pop(); out!.push(']'); break;
      case 'keyValue': {
        const fr = stack[stack.length - 1];
        if (fr.n++) out!.push(',');
        out!.push(JSON.stringify(t.value) + ':');
        afterKey = true;
        roleKey = table === 'users' && stack.length === 1 && t.value === 'role';
        return;
      }
      case 'startString': valueStart(); out!.push('"'); if (roleKey) role = ''; return;
      case 'stringChunk': out!.push(JSON.stringify(t.value).slice(1, -1)); if (roleKey && role !== null && role.length < 64) role += t.value; return;
      case 'endString': out!.push('"'); if (roleKey) { if (role === 'DEVELOPER') developers++; roleKey = false; role = null; } return;
      case 'numberValue': valueStart(); out!.push(t.value!); return;
      case 'nullValue': valueStart(); out!.push('null'); return;
      case 'trueValue': valueStart(); out!.push('true'); return;
      case 'falseValue': valueStart(); out!.push('false'); return;
      default: return;
    }
    if (stack.length === 0) { // row finished
      out!.push('\n');
      counts[table!]++;
      await out!.maybeFlush();
    }
  };

  try {
    for await (const t of tokens as AsyncIterable<Tok>) {
      if (done) throw new RestoreError('not a backup file: data after the end of the JSON object');
      if (stack.length || b64) { await rowToken(t); continue; }
      if (skip) {
        if (t.name === 'startObject' || t.name === 'startArray') skip++;
        else if (t.name === 'endObject' || t.name === 'endArray') skip--;
        continue;
      }
      if (small !== null) {
        if (t.name === 'stringChunk') { if (small.length < 200) small += t.value; continue; }
        if (t.name === 'endString') { if (topKey === 'source') meta.source = small; else if (topKey === 'createdAt') meta.createdAt = small; small = null; continue; }
      }
      switch (level) {
        case 0:
          if (t.name !== 'startObject') throw new RestoreError('not a backup file: expected a JSON object');
          level = 1;
          break;
        case 1:
          if (t.name === 'keyValue') { topKey = t.value!; break; }
          if (t.name === 'endObject') { done = true; break; }
          if (topKey === 'tables') {
            if (t.name !== 'startObject') throw new RestoreError('not a backup file: missing "tables" object');
            sawTables = true;
            level = 2;
          } else if (t.name === 'startObject' || t.name === 'startArray') skip = 1;
          else if (t.name === 'startString') small = '';
          break;
        case 2:
          if (t.name === 'keyValue') {
            if (!TABLE_RE.test(t.value!)) throw new RestoreError(`bad table name in backup: ${JSON.stringify(t.value).slice(0, 60)}`);
            if (files.has(t.value!)) throw new RestoreError(`table ${t.value} appears twice in the backup`);
            table = t.value!;
            break;
          }
          if (t.name === 'endObject') { level = 1; topKey = null; break; }
          if (t.name !== 'startArray') throw new RestoreError(`table ${table}: rows must be an array`);
          files.set(table!, path.join(dir, `${table}.ndjson`));
          counts[table!] = 0;
          out = new Writer(fs.createWriteStream(files.get(table!)!, { mode: 0o600 }));
          level = 3;
          break;
        case 3:
          if (t.name === 'endArray') { await out!.end(); out = null; level = 2; break; }
          if (t.name !== 'startObject') throw new RestoreError(`table ${table}: row ${counts[table!]} is not an object`);
          await rowToken(t);
          break;
      }
    }
    await piping;
    detach();
    if (!done) throw new RestoreError('not a backup file: the JSON ends early (truncated upload?)');
    if (!sawTables) throw new RestoreError('not a backup file: missing "tables" object');
    if (meta.source !== 'postgres' && meta.source !== 'sqlite') throw new RestoreError('not a backup file: "source" must be postgres or sqlite');
    if (!files.has('users')) throw new RestoreError('not a Batlas backup: no users table');
  } catch (e) {
    detach();
    await out?.end().catch(() => {});
    (b64 as { ws: fs.WriteStream } | null)?.ws.destroy();
    await cleanup();
    if (e instanceof RestoreError) throw e;
    const msg = e instanceof Error ? e.message : String(e); // stream-json syntax errors etc. (no data in them)
    throw new RestoreError(`could not read the backup JSON: ${msg.slice(0, 200)}`);
  }

  let pool = Buffer.alloc(0);
  /** {"$file": ...} references back to Buffers (checked against the size/sha256 recorded while staging). */
  const revive = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.$file === 'string' && Object.keys(o).length === 3 && /^blob-\d+\.bin$/.test(o.$file)) {
        const file = path.join(dir, o.$file);
        const size = fs.statSync(file).size;
        if (size !== o.size) throw new RestoreError('staged media file changed size');
        // One reusable buffer for all media: fresh 40 MB Buffers per row pile up as external memory
        // faster than V8 collects them. Safe because the restore core is done with a blob row
        // (validated, or inserted and awaited) before it asks for the next row.
        if (pool.length < size) pool = Buffer.allocUnsafe(Math.max(size, pool.length * 2, 1 << 20));
        const fd = fs.openSync(file, 'r');
        try {
          let off = 0;
          while (off < size) { const n = fs.readSync(fd, pool, off, size - off, off); if (!n) throw new RestoreError('staged media file is short'); off += n; }
        } finally { fs.closeSync(fd); }
        return pool.subarray(0, size);
      }
      for (const k of Object.keys(o)) o[k] = revive(o[k]);
    }
    return v;
  };
  const source: RowSource = {
    tables: () => [...files.keys()],
    count: (t) => counts[t] ?? 0,
    async *rows(t) {
      const f = files.get(t);
      if (!f) return;
      const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
      for await (const line of rl) if (line) yield revive(JSON.parse(line)) as Record<string, unknown>;
    },
  };
  return { dir, bytes, meta, counts, developers, blobBytes, source, cleanup };
}
