import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Ctx } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { randomToken } from '../lib/crypto.js';

const url = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\//i.test(v) || v.startsWith('/'), 'must be an http(s) URL or site path')
  .optional();

const gameSchema = z.object({
  slug: z.string().trim().toLowerCase().min(2).max(64).regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers and dashes'),
  title: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).optional(),
  description: z.string().max(20000).optional(),
  status: z.enum(['draft', 'upcoming', 'published']).optional(),
  version: z.string().trim().max(32).optional(),
  platforms: z.array(z.string().trim().max(30)).max(10).optional(),
  coverImage: url,
  screenshots: z.array(z.string().trim().max(500)).max(20).optional(),
  trailerUrl: url,
  playUrl: url,
  downloadUrl: url,
  config: z.record(z.string(), z.unknown()).optional(),
});

function toRow(b: Partial<z.infer<typeof gameSchema>>) {
  const row: Record<string, unknown> = {};
  if (b.slug !== undefined) row.slug = b.slug;
  if (b.title !== undefined) row.title = b.title;
  if (b.tagline !== undefined) row.tagline = b.tagline;
  if (b.description !== undefined) row.description = b.description;
  if (b.status !== undefined) row.status = b.status;
  if (b.version !== undefined) row.version = b.version;
  if (b.platforms !== undefined) row.platforms = b.platforms.join(',');
  if (b.coverImage !== undefined) row.cover_image = b.coverImage;
  if (b.screenshots !== undefined) row.screenshots = JSON.stringify(b.screenshots);
  if (b.trailerUrl !== undefined) row.trailer_url = b.trailerUrl;
  if (b.playUrl !== undefined) row.play_url = b.playUrl;
  if (b.downloadUrl !== undefined) row.download_url = b.downloadUrl;
  if (b.config !== undefined) row.config = JSON.stringify(b.config);
  return row;
}

export function gameOut(g: any, includeConfig = false) {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    tagline: g.tagline ?? '',
    description: g.description ?? '',
    status: g.status,
    version: g.version ?? '',
    platforms: g.platforms ? String(g.platforms).split(',').filter(Boolean) : [],
    coverImage: g.cover_image ?? '',
    screenshots: g.screenshots ? JSON.parse(g.screenshots) : [],
    trailerUrl: g.trailer_url ?? '',
    playUrl: g.play_url ?? '',
    downloadUrl: g.download_url ?? '',
    publishedAt: g.published_at,
    updatedAt: g.updated_at,
    ...(includeConfig ? { config: g.config ? JSON.parse(g.config) : {} } : {}),
  };
}

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: '.webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: '.gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' },
};

export function gamesRoutes(ctx: Ctx) {
  const r = Router();
  fs.mkdirSync(ctx.config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_TYPES),
  });

  // ---- public ----
  r.get('/games', async (_req, res) => {
    const rows = await ctx.db('games').whereIn('status', ['published', 'upcoming']).orderBy([{ column: 'status', order: 'asc' }, { column: 'updated_at', order: 'desc' }]);
    res.json({ games: rows.map((g) => gameOut(g)) });
  });

  r.get('/games/:slug', async (req, res) => {
    const g = await ctx.db('games').where({ slug: String(req.params.slug).toLowerCase() }).whereIn('status', ['published', 'upcoming']).first();
    if (!g) throw new HttpError(404, 'Game not found');
    res.json({ game: gameOut(g) });
  });

  // ---- developer only ----
  const dev = requirePermission('games.manage');

  r.get('/dev/games', dev, async (_req, res) => {
    const rows = await ctx.db('games').orderBy('updated_at', 'desc');
    res.json({ games: rows.map((g) => gameOut(g, true)) });
  });

  r.post('/dev/games', dev, async (req, res) => {
    const body = parse(gameSchema, req.body);
    if (await ctx.db('games').where({ slug: body.slug }).first()) throw new HttpError(409, 'A game with that slug already exists');
    const now = new Date().toISOString();
    const row = { ...toRow(body), status: body.status ?? 'draft', created_at: now, updated_at: now, published_at: body.status === 'published' ? now : null };
    const [id] = await ctx.db('games').insert(row);
    await audit(ctx.db, req, { action: 'game.create', category: 'games', targetType: 'game', targetId: id, targetLabel: body.slug });
    res.status(201).json({ game: gameOut(await ctx.db('games').where({ id }).first(), true) });
  });

  r.patch('/dev/games/:id', dev, async (req, res) => {
    const id = Number(req.params.id);
    const g = await ctx.db('games').where({ id }).first();
    if (!g) throw new HttpError(404, 'Game not found');
    const body = parse(gameSchema.partial(), req.body);
    if (body.slug && body.slug !== g.slug && (await ctx.db('games').where({ slug: body.slug }).first())) throw new HttpError(409, 'Slug already in use');
    const row = { ...toRow(body), updated_at: new Date().toISOString() } as Record<string, unknown>;
    if (body.status === 'published' && !g.published_at) row.published_at = new Date().toISOString();
    await ctx.db('games').where({ id }).update(row);
    await audit(ctx.db, req, { action: 'game.update', category: 'games', targetType: 'game', targetId: id, targetLabel: g.slug, details: { fields: Object.keys(body) } });
    res.json({ game: gameOut(await ctx.db('games').where({ id }).first(), true) });
  });

  r.post('/dev/games/:id/publish', dev, async (req, res) => {
    const id = Number(req.params.id);
    const g = await ctx.db('games').where({ id }).first();
    if (!g) throw new HttpError(404, 'Game not found');
    const { status } = parse(z.object({ status: z.enum(['draft', 'upcoming', 'published']) }), req.body);
    const now = new Date().toISOString();
    await ctx.db('games').where({ id }).update({ status, updated_at: now, ...(status === 'published' && !g.published_at ? { published_at: now } : {}) });
    await audit(ctx.db, req, { action: 'game.status', category: 'games', targetType: 'game', targetId: id, targetLabel: g.slug, details: { from: g.status, to: status } });
    res.json({ game: gameOut(await ctx.db('games').where({ id }).first(), true) });
  });

  r.post('/dev/uploads', dev, upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f) throw new HttpError(400, 'Upload a PNG, JPEG, WebP or GIF image as "file"');
    const t = IMAGE_TYPES[f.mimetype];
    if (!t || !t.magic(f.buffer)) throw new HttpError(400, 'File content is not a valid image');
    const name = `${Date.now()}-${randomToken(9)}${t.ext}`;
    await fs.promises.writeFile(path.join(ctx.config.uploadDir, name), f.buffer, { flag: 'wx' });
    await audit(ctx.db, req, { action: 'upload.image', category: 'games', targetType: 'file', targetId: name, details: { size: f.size, type: f.mimetype } });
    res.status(201).json({ url: `/uploads/${name}` });
  });

  return r;
}
