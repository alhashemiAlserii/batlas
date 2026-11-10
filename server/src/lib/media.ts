import type { Knex } from 'knex';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { insertId } from '../db/index.js';

/**
 * Uploaded images, trailers and avatars are stored IN THE DATABASE (bytea on Postgres, blob on
 * SQLite) because Render's free plan wipes the local disk on every deploy. They are served from
 * /media/:id with the right Content-Type, long-lived caching (rows are immutable) and HTTP Range
 * support, which iOS Safari requires before it will play an MP4.
 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
/** Largest slice read from the database per query when streaming (keeps memory flat). */
const CHUNK = 1024 * 1024;
/** Longest body returned for one Range request; clients ask again for the rest. */
const MAX_RANGE = 4 * 1024 * 1024;

export const MEDIA_TYPES: Record<string, { kind: 'image' | 'video'; ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { kind: 'image', ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { kind: 'image', ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { kind: 'image', ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { kind: 'image', ext: 'gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' },
  // ISO BMFF: bytes 4..8 are "ftyp". Covers .mp4 and .m4v (H.264/AAC plays everywhere incl. iOS).
  'video/mp4': { kind: 'video', ext: 'mp4', magic: (b) => b.length > 12 && b.subarray(4, 8).toString() === 'ftyp' },
};

/** Content sniffing wins over the browser-supplied type (a .mov renamed .mp4 still sniffs as ftyp). */
export function sniff(buf: Buffer, declared?: string): string | null {
  if (declared && MEDIA_TYPES[declared]?.magic(buf)) return declared;
  for (const [t, d] of Object.entries(MEDIA_TYPES)) if (d.magic(buf)) return t;
  return null;
}

export async function storeMedia(db: Knex, o: { kind: string; contentType: string; data: Buffer; filename?: string; gameId?: number | null; userId?: number | null }) {
  const sha = crypto.createHash('sha256').update(o.data).digest('hex');
  const id = await insertId(db('media').insert({
    kind: o.kind, content_type: o.contentType, size: o.data.length, sha256: sha, data: o.data,
    filename: o.filename?.slice(0, 200) ?? null, game_id: o.gameId ?? null, uploaded_by: o.userId ?? null, created_at: new Date().toISOString(),
  }));
  const ext = MEDIA_TYPES[o.contentType]?.ext ?? 'bin';
  return { id, url: `/media/${id}.${ext}`, size: o.data.length, contentType: o.contentType, sha256: sha };
}

export const mediaIdFromUrl = (u: string | null | undefined): number | null => {
  const m = /^\/media\/(\d+)(?:\.[a-z0-9]+)?$/.exec(String(u ?? ''));
  return m ? Number(m[1]) : null;
};

export function mediaOut(m: any) {
  const ext = MEDIA_TYPES[m.content_type]?.ext ?? 'bin';
  return { id: m.id, kind: m.kind, contentType: m.content_type, size: Number(m.size), filename: m.filename ?? '', gameId: m.game_id ?? null, url: `/media/${m.id}.${ext}`, createdAt: m.created_at };
}

const isPg = (db: Knex) => String(db.client.config.client).includes('pg');

/** Reads bytes [start, start+len) of a media row without loading the whole blob. */
async function readSlice(db: Knex, id: number, start: number, len: number): Promise<Buffer> {
  // Both substr()/substring() are 1-based and work on blobs/bytea.
  const sql = isPg(db) ? 'select substring(data from ? for ?) as d from media where id = ?' : 'select substr(data, ?, ?) as d from media where id = ?';
  const res: any = await db.raw(sql, [start + 1, len, id]);
  const row = isPg(db) ? res.rows[0] : res[0];
  const d = row?.d;
  return Buffer.isBuffer(d) ? d : Buffer.from(d ?? []);
}

/** GET/HEAD /media/:id[.ext] with Range support. */
export async function serveMedia(db: Knex, req: Request, res: Response) {
  const id = Number(/^(\d+)/.exec(String(req.params.id ?? ''))?.[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).end();
  const m = await db('media').where({ id }).first('id', 'content_type', 'size', 'sha256');
  if (!m) return res.status(404).type('text/plain').send('Not found');
  const size = Number(m.size);
  const etag = `"${m.sha256}"`;
  res.set({
    'Content-Type': m.content_type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    // Rows are never modified in place (a new upload gets a new id), so cache "forever".
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  let start = 0;
  let end = size - 1;
  let partial = false;
  const range = req.headers.range;
  const ifRange = req.headers['if-range'];
  if (range && (!ifRange || ifRange === etag)) {
    const mm = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!mm || (mm[1] === '' && mm[2] === '')) { res.set('Content-Range', `bytes */${size}`); return res.status(416).end(); }
    if (mm[1] === '') { start = Math.max(0, size - Number(mm[2])); end = size - 1; } // suffix: last N bytes
    else { start = Number(mm[1]); end = mm[2] === '' ? size - 1 : Math.min(Number(mm[2]), size - 1); }
    if (start >= size || start > end) { res.set('Content-Range', `bytes */${size}`); return res.status(416).end(); }
    end = Math.min(end, start + MAX_RANGE - 1);
    partial = true;
  }
  const len = end - start + 1;
  res.status(partial ? 206 : 200);
  if (partial) res.set('Content-Range', `bytes ${start}-${end}/${size}`);
  res.set('Content-Length', String(len));
  if (req.method === 'HEAD') return res.end();
  for (let off = start; off <= end; off += CHUNK) {
    const chunk = await readSlice(db, id, off, Math.min(CHUNK, end - off + 1));
    if (!res.write(chunk)) await new Promise<void>((r) => res.once('drain', () => r()));
    if (res.destroyed) return;
  }
  res.end();
}
