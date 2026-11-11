import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/index.js';
import { SERVER_ROOT } from '../src/config.js';
import { makeLargeBackup } from '../scripts/make-large-backup.js';
import { restoreRequest } from '../scripts/restore-remote.js';

/**
 * Restores a large synthetic media backup through the real endpoint in a separate server
 * process with a capped V8 heap, and checks the process's peak RSS (VmHWM) stays well under
 * Render's 512 MB. Size: RESTORE_MEM_MEDIA x RESTORE_MEM_MB (default 16 x 10 MB = 160 MB of media,
 * ~214 MB of JSON). Larger runs: see docs/BACKUP-RESTORE.md.
 */
const MEDIA = Number(process.env.RESTORE_MEM_MEDIA ?? 16);
const MB = Number(process.env.RESTORE_MEM_MB ?? 10);
const LIMIT_MB = 400;
const hwm = (pid: number) => { try { const m = /VmHWM:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Number(m[1]) / 1024 : null; } catch { return null; } };

describe('restore endpoint memory', () => {
  it(`streams a ${MEDIA * MB} MB media backup with peak RSS < ${LIMIT_MB} MB`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-mem-'));
    const file = path.join(tmp, 'large.json');
    const made = await makeLargeBackup(file, { media: MEDIA, mb: MB });
    const token = crypto.randomBytes(32).toString('hex');
    const pgUrl = process.env.TEST_DATABASE_URL;
    const schema = pgUrl ? `mem_${process.pid}_${Date.now()}` : undefined;
    if (pgUrl) { const a = createDb(pgUrl); await a.raw(`create schema "${schema}"`); await a.destroy(); }
    const target = pgUrl ?? path.join(tmp, 'target.sqlite');
    const child = spawn(process.execPath, ['--max-old-space-size=256', '--import', 'tsx', 'tests/fixtures/restore-server.ts'], {
      cwd: SERVER_ROOT,
      env: { ...process.env, TARGET: target, PG_SCHEMA: schema ?? '', RESTORE_TOKEN: token, MAINTENANCE_MODE: 'true', RESTORE_TMP_DIR: tmp, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (d) => { out += d; const m = /PORT (\d+)/.exec(out); if (m) resolve(Number(m[1])); });
        child.on('exit', (c) => reject(new Error(`server exited ${c}: ${err.slice(-500)}`)));
      });
      const baseline = hwm(child.pid!);
      const url = `http://127.0.0.1:${port}`;
      const t0 = Date.now();
      const r = await restoreRequest({ url, token, file, mode: 'restore' });
      const secs = (Date.now() - t0) / 1000;
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.counts.media).toBe(MEDIA);
      expect(r.body.rows).toBe(made.rows);
      const peak = hwm(child.pid!);
      console.log(`[memory] ${pgUrl ? 'postgres' : 'sqlite'}: file ${(made.size / 2 ** 20).toFixed(0)} MB (${(made.mediaBytes / 2 ** 20).toFixed(0)} MB media, ${MEDIA} x ${MB} MB), restored in ${secs.toFixed(1)} s, server peak RSS ${peak?.toFixed(0)} MB (idle ${baseline?.toFixed(0)} MB)`);
      if (peak != null) expect(peak).toBeLessThan(LIMIT_MB);
      // the bytes really arrived intact
      const db = createDb(target, schema ? { schema } : {});
      try {
        const rows = await db('media').select('id', 'sha256', 'data');
        expect(rows.length).toBe(MEDIA);
        for (const m of rows) expect(crypto.createHash('sha256').update(m.data).digest('hex')).toBe(m.sha256);
        if (schema) await db.raw(`drop schema "${schema}" cascade`);
      } finally { await db.destroy(); }
      expect(fs.readdirSync(tmp).filter((f) => f.startsWith('batlas-restore-'))).toEqual([]); // staging cleaned up
    } finally {
      child.kill('SIGTERM');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 600_000);
});
