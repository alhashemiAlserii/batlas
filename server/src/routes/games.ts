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
import { insertId } from '../db/index.js';
import { storeMedia, mediaIdFromUrl, IMAGE_MAX_BYTES } from '../lib/media.js';
import { WEB_ROOT } from '../config.js';

/** Public per-game settings, editable in the Developer dashboard. */
export const settingsSchema = z.object({
  featured: z.boolean().optional(), // show as the homepage's featured game
  playEnabled: z.boolean().optional(), // false hides "Play in browser" (e.g. during an update)
  downloadEnabled: z.boolean().optional(),
  showLeaderboard: z.boolean().optional(),
  maintenanceMessage: z.string().trim().max(200).optional(), // shown instead of Play when play is off
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, '#rrggbb').or(z.literal('')).optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
}).strict();
export type GameSettings = z.infer<typeof settingsSchema>;
const DEFAULT_SETTINGS: Required<GameSettings> = { featured: false, playEnabled: true, downloadEnabled: true, showLeaderboard: true, maintenanceMessage: '', accentColor: '', sortOrder: 0 };
export const parseSettings = (s: unknown): Required<GameSettings> => {
  try { return { ...DEFAULT_SETTINGS, ...(typeof s === 'string' && s ? JSON.parse(s) : {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
};

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
  trailerVideo: url, // uploaded MP4 (/media/:id.mp4)
  trailerPoster: url,
  youtubeUrl: z.string().trim().max(300).refine((v) => v === '' || /^https:\/\/(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(v), 'must be a YouTube link').optional(),
  releaseDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'YYYY-MM-DD').refine((d) => d === '' || !isNaN(Date.parse(d)), 'invalid date').optional(),
  settings: settingsSchema.optional(),
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
  if (b.trailerVideo !== undefined) row.trailer_video = b.trailerVideo || null;
  if (b.trailerPoster !== undefined) row.trailer_poster = b.trailerPoster || null;
  if (b.youtubeUrl !== undefined) row.youtube_url = b.youtubeUrl || null;
  if (b.releaseDate !== undefined) row.release_date = b.releaseDate || null;
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
    trailerVideo: g.trailer_video ?? '',
    trailerPoster: g.trailer_poster ?? '',
    youtubeUrl: g.youtube_url ?? '',
    releaseDate: g.release_date ?? '',
    settings: parseSettings(g.settings),
    publishedAt: g.published_at,
    updatedAt: g.updated_at,
    ...(includeConfig ? { config: g.config ? JSON.parse(g.config) : {} } : {}),
  };
}

export function versionOut(v: any) {
  return { id: v.id, version: v.version, releasedAt: String(v.released_at).slice(0, 10), changelog: v.changelog ?? '', downloadUrl: v.download_url ?? '' };
}

export const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
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
    limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in IMAGE_TYPES),
  });

  // ---- public ----
  r.get('/games', async (_req, res) => {
    const rows = await ctx.db('games').whereIn('status', ['published', 'upcoming']).orderBy([{ column: 'status', order: 'asc' }, { column: 'updated_at', order: 'desc' }]);
    const games = rows.map((g) => gameOut(g)).sort((a, b) => Number(b.settings.featured) - Number(a.settings.featured) || a.settings.sortOrder - b.settings.sortOrder);
    res.json({ games });
  });

  r.get('/games/:slug', async (req, res) => {
    const g = await ctx.db('games').where({ slug: String(req.params.slug).toLowerCase() }).whereIn('status', ['published', 'upcoming']).first();
    if (!g) throw new HttpError(404, 'Game not found');
    const versions = await ctx.db('game_versions').where({ game_id: g.id }).orderBy([{ column: 'released_at', order: 'desc' }, { column: 'id', order: 'desc' }]);
    const out = gameOut(g);
    const vs = versions.map(versionOut);
    // The Download button is only offered when the file really exists (or is an external link)
    // and downloads are enabled for this game.
    const candidate = vs[0]?.downloadUrl || out.downloadUrl;
    const download = out.settings.downloadEnabled && candidate && (await downloadExists(candidate)) ? candidate : '';
    const news = await ctx.db('news_posts').where({ game_id: g.id, status: 'published' }).orderBy('published_at', 'desc').limit(5).select('slug', 'title', 'summary', 'published_at');
    res.json({ game: { ...out, versions: vs, latestVersion: vs[0] ?? null, download, news: news.map((n) => ({ slug: n.slug, title: n.title, summary: n.summary ?? '', publishedAt: n.published_at })) } });
  });

  async function downloadExists(u: string): Promise<boolean> {
    if (/^https?:\/\//i.test(u)) return true; // external host: trust the link
    if (!u.startsWith('/') || u.startsWith('//')) return false;
    const mid = mediaIdFromUrl(u);
    if (mid) return !!(await ctx.db('media').where({ id: mid }).first('id'));
    const clean = path.posix.normalize(decodeURIComponent(u.split('?')[0]));
    if (clean.includes('..')) return false;
    if (clean.startsWith('/uploads/')) return fs.existsSync(path.join(ctx.config.uploadDir, clean.slice('/uploads/'.length)));
    const p = path.join(WEB_ROOT, 'public', clean);
    return p.startsWith(path.join(WEB_ROOT, 'public')) && fs.existsSync(p) && fs.statSync(p).isFile();
  }

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
    const row = { ...toRow(body), ...(body.settings ? { settings: JSON.stringify(body.settings) } : {}), status: body.status ?? 'draft', created_at: now, updated_at: now, published_at: body.status === 'published' ? now : null };
    const id = await insertId(ctx.db('games').insert(row));
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
    if (body.settings) row.settings = JSON.stringify({ ...parseSettings(g.settings), ...body.settings });
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

  // ---- version history ----
  const versionSchema = z.object({
    version: z.string().trim().min(1).max(32).regex(/^[\w.+-]+$/, 'letters, numbers, dots, dashes'),
    releasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine((d) => !isNaN(Date.parse(d)), 'invalid date'),
    changelog: z.string().max(20000).optional(),
    downloadUrl: url,
  });

  r.get('/dev/games/:id/versions', dev, async (req, res) => {
    const rows = await ctx.db('game_versions').where({ game_id: Number(req.params.id) }).orderBy([{ column: 'released_at', order: 'desc' }, { column: 'id', order: 'desc' }]);
    res.json({ versions: rows.map(versionOut) });
  });

  r.post('/dev/games/:id/versions', dev, async (req, res) => {
    const id = Number(req.params.id);
    const g = await ctx.db('games').where({ id }).first();
    if (!g) throw new HttpError(404, 'Game not found');
    const b = parse(versionSchema, req.body);
    if (await ctx.db('game_versions').where({ game_id: id, version: b.version }).first()) throw new HttpError(409, 'That version already exists for this game');
    const vid = await insertId(ctx.db('game_versions').insert({ game_id: id, version: b.version, released_at: b.releasedAt, changelog: b.changelog ?? '', download_url: b.downloadUrl || null, created_at: new Date().toISOString() }));
    // Keep the game's "current version" in sync with the newest release.
    const latest = await ctx.db('game_versions').where({ game_id: id }).orderBy([{ column: 'released_at', order: 'desc' }, { column: 'id', order: 'desc' }]).first();
    await ctx.db('games').where({ id }).update({ version: latest.version, updated_at: new Date().toISOString() });
    await audit(ctx.db, req, { action: 'game.version.add', category: 'games', targetType: 'game', targetId: id, targetLabel: g.slug, details: { version: b.version } });
    res.status(201).json({ version: versionOut(await ctx.db('game_versions').where({ id: vid }).first()) });
  });

  r.delete('/dev/games/:id/versions/:vid', dev, async (req, res) => {
    const id = Number(req.params.id);
    const v = await ctx.db('game_versions').where({ id: Number(req.params.vid), game_id: id }).first();
    if (!v) throw new HttpError(404, 'Version not found');
    await ctx.db('game_versions').where({ id: v.id }).delete();
    const latest = await ctx.db('game_versions').where({ game_id: id }).orderBy([{ column: 'released_at', order: 'desc' }, { column: 'id', order: 'desc' }]).first();
    if (latest) await ctx.db('games').where({ id }).update({ version: latest.version });
    await audit(ctx.db, req, { action: 'game.version.delete', category: 'games', targetType: 'game', targetId: id, details: { version: v.version } });
    res.json({ ok: true });
  });

  // Legacy image upload endpoint (kept for compatibility). Now stored in the database, not on disk.
  r.post('/dev/uploads', dev, upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f) throw new HttpError(400, 'Upload a PNG, JPEG, WebP or GIF image as "file"');
    const t = IMAGE_TYPES[f.mimetype];
    if (!t || !t.magic(f.buffer)) throw new HttpError(400, 'File content is not a valid image');
    const m = await storeMedia(ctx.db, { kind: 'image', contentType: f.mimetype, data: f.buffer, filename: f.originalname, userId: req.user!.id });
    await audit(ctx.db, req, { action: 'upload.image', category: 'media', targetType: 'media', targetId: m.id, details: { size: f.size, type: f.mimetype } });
    res.status(201).json({ url: m.url, id: m.id });
  });

  return r;
}
