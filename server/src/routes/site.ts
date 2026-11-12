import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { adminUser, publicUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { insertId } from '../db/index.js';
import { hasPermission } from '../lib/permissions.js';
import { displayNameSchema } from '../lib/schemas.js';
import { getMaintenance, setMaintenance } from '../lib/maintenance.js';
import { storeMedia, sniff, mediaOut, MEDIA_TYPES, IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from '../lib/media.js';
import { loadTarget, guard } from './admin.js';

/** Summary of live game rooms supplied by the process that runs the game server (index.ts). */
export type LiveRoomsProvider = () => Array<{ code: string; host: string | null; players: number; max: number | null; locked: boolean; route: string | null; phase: string | null }> | null;

const iso = z.string().trim().max(40).refine((v) => !isNaN(Date.parse(v)), 'invalid date/time');
const siteUrl = z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\//i.test(v) || (v.startsWith('/') && !v.startsWith('//')), 'must be an http(s) URL or site path');
const eventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().max(500).optional(),
  style: z.enum(['info', 'event', 'warning']).optional(),
  linkUrl: siteUrl.optional(),
  gameId: z.number().int().positive().nullable().optional(),
  announceAt: iso.optional(), // default: now
  startsAt: iso,
  endsAt: iso,
  cancelled: z.boolean().optional(),
});

function eventOut(e: any) {
  return {
    id: e.id, title: e.title, message: e.message ?? '', style: e.style, linkUrl: e.link_url ?? '', gameId: e.game_id ?? null,
    announceAt: e.announce_at, startsAt: e.starts_at, endsAt: e.ends_at, cancelled: !!e.cancelled,
    createdAt: e.created_at, updatedAt: e.updated_at,
  };
}

export function siteRoutes(ctx: Ctx, deps: { liveRooms?: LiveRoomsProvider } = {}) {
  const r = Router();

  // ---------- maintenance ----------
  r.get('/maintenance', async (req, res) => {
    const m = await getMaintenance(ctx.db);
    res.json({ on: m.on, forced: m.forced, message: m.message, eta: m.eta, youCanBypass: req.user?.role === 'DEVELOPER' });
  });

  r.get('/dev/maintenance', requirePermission('site.maintenance'), async (_req, res) => {
    res.json(await getMaintenance(ctx.db));
  });

  r.put('/dev/maintenance', requirePermission('site.maintenance'), async (req, res) => {
    const b = parse(z.object({ enabled: z.boolean(), message: z.string().trim().max(500).optional(), eta: iso.nullable().or(z.literal('')).optional() }).strict(), req.body);
    const before = await getMaintenance(ctx.db);
    const eta = b.eta ? new Date(b.eta).toISOString() : null;
    const after = await setMaintenance(ctx.db, { enabled: b.enabled, message: b.message ?? '', eta }, req.user!.id);
    const action = before.enabled === b.enabled ? 'maintenance.update' : b.enabled ? 'maintenance.on' : 'maintenance.off';
    await audit(ctx.db, req, { action, category: 'site', targetType: 'site', targetLabel: 'maintenance', details: { enabled: b.enabled, message: b.message ?? '', eta, forcedByEnv: after.forced } });
    res.json(after);
  });

  // ---------- site-wide event banners ----------
  r.get('/events/active', async (_req, res) => {
    const now = new Date().toISOString();
    const rows = await ctx.db('site_events').where('cancelled', false).andWhere('announce_at', '<=', now).andWhere('ends_at', '>', now).orderBy('starts_at', 'asc').limit(3);
    res.json({ events: rows.map(eventOut), now });
  });

  const ev = requirePermission('site.events');
  r.get('/dev/events', ev, async (_req, res) => {
    const rows = await ctx.db('site_events').orderBy('starts_at', 'desc').limit(100);
    res.json({ events: rows.map(eventOut) });
  });

  async function checkEvent(b: { startsAt?: string; endsAt?: string; announceAt?: string; gameId?: number | null }, cur?: any) {
    const starts = b.startsAt ?? cur?.starts_at, ends = b.endsAt ?? cur?.ends_at, ann = b.announceAt ?? cur?.announce_at;
    if (Date.parse(ends) <= Date.parse(starts)) throw new HttpError(400, 'The event must end after it starts.');
    if (ann && Date.parse(ann) > Date.parse(starts)) throw new HttpError(400, 'Announce the event before (or when) it starts.');
    if (b.gameId && !(await ctx.db('games').where({ id: b.gameId }).first('id'))) throw new HttpError(400, 'Unknown game');
  }
  const evRow = (b: Partial<z.infer<typeof eventSchema>>) => {
    const row: Record<string, unknown> = {};
    if (b.title !== undefined) row.title = b.title;
    if (b.message !== undefined) row.message = b.message;
    if (b.style !== undefined) row.style = b.style;
    if (b.linkUrl !== undefined) row.link_url = b.linkUrl || null;
    if (b.gameId !== undefined) row.game_id = b.gameId;
    if (b.announceAt !== undefined) row.announce_at = new Date(b.announceAt).toISOString();
    if (b.startsAt !== undefined) row.starts_at = new Date(b.startsAt).toISOString();
    if (b.endsAt !== undefined) row.ends_at = new Date(b.endsAt).toISOString();
    if (b.cancelled !== undefined) row.cancelled = b.cancelled;
    return row;
  };

  r.post('/dev/events', ev, async (req, res) => {
    const b = parse(eventSchema, req.body);
    await checkEvent(b);
    const now = new Date().toISOString();
    const id = await insertId(ctx.db('site_events').insert({ style: 'event', ...evRow(b), announce_at: new Date(b.announceAt ?? now).toISOString(), created_by: req.user!.id, created_at: now, updated_at: now }));
    await audit(ctx.db, req, { action: 'event.create', category: 'site', targetType: 'event', targetId: id, targetLabel: b.title, details: { startsAt: b.startsAt, endsAt: b.endsAt } });
    res.status(201).json({ event: eventOut(await ctx.db('site_events').where({ id }).first()) });
  });

  r.patch('/dev/events/:id', ev, async (req, res) => {
    const id = Number(req.params.id);
    const cur = await ctx.db('site_events').where({ id }).first();
    if (!cur) throw new HttpError(404, 'Event not found');
    const b = parse(eventSchema.partial(), req.body);
    await checkEvent(b, cur);
    await ctx.db('site_events').where({ id }).update({ ...evRow(b), updated_at: new Date().toISOString() });
    await audit(ctx.db, req, { action: b.cancelled === true ? 'event.cancel' : 'event.update', category: 'site', targetType: 'event', targetId: id, targetLabel: cur.title, details: { fields: Object.keys(b) } });
    res.json({ event: eventOut(await ctx.db('site_events').where({ id }).first()) });
  });

  r.delete('/dev/events/:id', ev, async (req, res) => {
    const id = Number(req.params.id);
    const cur = await ctx.db('site_events').where({ id }).first();
    if (!cur) throw new HttpError(404, 'Event not found');
    await ctx.db('site_events').where({ id }).delete();
    await audit(ctx.db, req, { action: 'event.delete', category: 'site', targetType: 'event', targetId: id, targetLabel: cur.title });
    res.json({ ok: true });
  });

  // ---------- online players ----------
  r.get('/admin/online', requirePermission('players.online'), async (req, res) => {
    const minutes = Math.min(Math.max(Number(req.query.minutes) || 5, 1), 60);
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const rows = await ctx.db<UserRow>('users').where('last_seen_at', '>=', since).orderBy('last_seen_at', 'desc').limit(500);
    // Live rooms come from the in-process game server; only the Developer sees them (same rule as in-game).
    let rooms: ReturnType<LiveRoomsProvider> = null;
    if (hasPermission(req.user!.role, 'dev.menu') && deps.liveRooms) {
      try { rooms = deps.liveRooms(); } catch { rooms = null; }
    }
    res.json({
      minutes,
      users: rows.map((u) => ({ ...publicUser(u), lastSeenAt: u.last_seen_at, banned: !!u.banned })),
      rooms,
      gameServer: deps.liveRooms ? (rooms ? 'online' : hasPermission(req.user!.role, 'dev.menu') ? 'offline' : 'hidden') : 'not-attached',
    });
  });

  // ---------- player account management ----------
  r.patch('/admin/users/:id/profile', requirePermission('players.edit'), async (req, res) => {
    const b = parse(z.object({ displayName: displayNameSchema.optional(), bio: z.string().trim().max(500).optional() }).strict(), req.body);
    const target = await loadTarget(ctx, req);
    await guard(ctx, req, target, 'player.profile_edit');
    const update: Record<string, unknown> = {};
    if (b.displayName !== undefined) update.display_name = b.displayName;
    if (b.bio !== undefined) update.bio = b.bio;
    if (!Object.keys(update).length) throw new HttpError(400, 'Nothing to change');
    await ctx.db('users').where({ id: target.id }).update(update);
    await audit(ctx.db, req, { action: 'player.profile_edit', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { fields: Object.keys(update), before: { displayName: target.display_name, bio: target.bio } } });
    res.json({ ok: true, user: adminUser((await ctx.db<UserRow>('users').where({ id: target.id }).first())!) });
  });

  // ---------- media library (database-backed) ----------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: VIDEO_MAX_BYTES, files: 1 } });
  const media = requirePermission('media.upload');

  r.post('/dev/media', media, upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f) throw new HttpError(400, 'Choose a file to upload (PNG, JPEG, WebP, GIF image or MP4 video).');
    const type = sniff(f.buffer, f.mimetype);
    if (!type) throw new HttpError(400, 'Unsupported file. Images: PNG, JPEG, WebP, GIF. Trailers: MP4 (H.264).', 'bad_media');
    const kind = MEDIA_TYPES[type].kind;
    const cap = kind === 'video' ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
    if (f.size > cap) throw new HttpError(413, `${kind === 'video' ? 'Trailers' : 'Images'} can be at most ${cap / 1024 / 1024} MB.`, 'too_large');
    const gameId = req.body?.gameId ? Number(req.body.gameId) : null;
    if (gameId && !(await ctx.db('games').where({ id: gameId }).first('id'))) throw new HttpError(400, 'Unknown game');
    const m = await storeMedia(ctx.db, { kind, contentType: type, data: f.buffer, filename: f.originalname, gameId, userId: req.user!.id });
    await audit(ctx.db, req, { action: `media.upload.${kind}`, category: 'media', targetType: 'media', targetId: m.id, targetLabel: f.originalname?.slice(0, 100), details: { size: f.size, type, gameId } });
    res.status(201).json({ media: { id: m.id, url: m.url, kind, contentType: type, size: f.size } });
  });

  r.get('/dev/media', media, async (req, res) => {
    let q = ctx.db('media').whereNot({ kind: 'avatar' }).orderBy('id', 'desc').limit(200).select('id', 'kind', 'content_type', 'size', 'filename', 'game_id', 'created_at');
    if (req.query.gameId) q = q.where({ game_id: Number(req.query.gameId) });
    const rows = await q;
    const total = await ctx.db('media').sum({ n: 'size' }).first();
    res.json({ media: rows.map(mediaOut), totalBytes: Number(total?.n ?? 0) });
  });

  r.delete('/dev/media/:id', media, async (req, res) => {
    const id = Number(req.params.id);
    const m = await ctx.db('media').where({ id }).first('id', 'kind', 'filename', 'size');
    if (!m || m.kind === 'avatar') throw new HttpError(404, 'Media not found');
    await ctx.db('media').where({ id }).delete();
    await audit(ctx.db, req, { action: 'media.delete', category: 'media', targetType: 'media', targetId: id, targetLabel: m.filename ?? '', details: { size: Number(m.size) } });
    res.json({ ok: true });
  });

  return r;
}
