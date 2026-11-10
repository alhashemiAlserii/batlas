/**
 * /api/game — the namespace game clients and game servers talk to.
 *
 * Auth model (designed for the co-op airplane game, Stage 4):
 *  1. A logged-in player's client calls POST /api/game/token (cookie session) and receives a
 *     short-lived opaque token.
 *  2. The client presents that token to a game server.
 *  3. The game server calls POST /api/game/verify with header `X-Game-Server-Key` and the token,
 *     and receives the user's id, name, role and permission list. The game server trusts only
 *     this response, never anything the client says about itself.
 *  4. Privileged actions (weather, emergencies, spawning...) are validated here and audit-logged.
 *     Stage 1 stubs return ok without touching a live game.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { publicUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requireAuth, requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { hasPermission, ITEM_TIERS, permissionsFor } from '../lib/permissions.js';
import { insertId } from '../db/index.js';

const GAME_TOKEN_TTL_MS = 10 * 60 * 1000;

export const WEATHER = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const;
export const EMERGENCIES = ['engine_failure', 'turbulence', 'weather_emergency', 'cabin_pressure', 'emergency_landing', 'evacuation', 'system_failure'] as const;

export function gameRoutes(ctx: Ctx) {
  const r = Router();

  r.post('/game/token', requireAuth, async (req, res) => {
    if (req.authVia !== 'session') throw new HttpError(403, 'Game tokens must be requested with a website session');
    const { game } = parse(z.object({ game: z.string().trim().max(64).optional() }), req.body ?? {});
    const token = randomToken(32);
    const expires = new Date(Date.now() + GAME_TOKEN_TTL_MS);
    await ctx.db('game_tokens').insert({ token_hash: sha256(token), user_id: req.user!.id, game_slug: game ?? null, expires_at: expires.toISOString(), created_at: new Date().toISOString() });
    res.json({ token, expiresAt: expires.toISOString() });
  });

  r.post('/game/verify', async (req, res) => {
    const key = req.get('x-game-server-key') ?? '';
    if (!ctx.config.gameServerKey || !safeEqual(key, ctx.config.gameServerKey)) throw new HttpError(401, 'Invalid game server key');
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const row = await ctx.db('game_tokens').where({ token_hash: sha256(token) }).first();
    if (!row || new Date(row.expires_at) <= new Date()) return res.status(401).json({ valid: false });
    const u = await ctx.db<UserRow>('users').where({ id: row.user_id }).first();
    if (!u || u.banned) return res.status(403).json({ valid: false, banned: !!u?.banned });
    res.json({ valid: true, user: publicUser(u), role: u.role, permissions: permissionsFor(u.role), game: row.game_slug });
  });

  // In-game admin actions reported by a game server (authenticated by X-Game-Server-Key).
  r.post('/game/audit', async (req, res) => {
    const key = req.get('x-game-server-key') ?? '';
    if (!ctx.config.gameServerKey || !safeEqual(key, ctx.config.gameServerKey)) throw new HttpError(401, 'Invalid game server key');
    const b = parse(z.object({
      actorUserId: z.number().int().positive(),
      action: z.string().regex(/^ingame\.[a-z.\-_]{1,48}$/),
      targetUserId: z.number().int().positive().optional(),
      targetLabel: z.string().max(64).optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }), req.body);
    const actor = await ctx.db<UserRow>('users').where({ id: b.actorUserId }).first();
    if (!actor) throw new HttpError(404, 'Unknown actor');
    const category = /kick/.test(b.action) ? 'moderation' : 'game';
    await audit(ctx.db, req, { action: b.action, category, targetType: b.targetUserId ? 'user' : 'room', targetId: b.targetUserId ?? (b.details?.room as string | undefined), targetLabel: b.targetLabel, details: b.details }, actor);
    res.json({ ok: true });
  });

  r.post('/game/weather', requirePermission('weather.change'), async (req, res) => {
    const body = parse(z.object({ weather: z.enum(WEATHER), session: z.string().max(64).optional() }), req.body);
    await audit(ctx.db, req, { action: 'game.weather.change', category: 'game', targetType: 'session', targetId: body.session ?? 'all', details: body });
    res.json({ ok: true, applied: false, note: 'Stage 1 stub: validated and logged; no live game connected yet.' });
  });

  r.post('/game/emergency', requirePermission('emergency.trigger'), async (req, res) => {
    const body = parse(z.object({ scenario: z.enum(EMERGENCIES), action: z.enum(['start', 'stop']).default('start'), session: z.string().max(64).optional() }), req.body);
    if (body.action === 'stop' && !hasPermission(req.user!.role, 'emergency.manage')) throw new HttpError(403, 'You do not have permission to do that.', 'forbidden');
    await audit(ctx.db, req, { action: `game.emergency.${body.action}`, category: 'game', targetType: 'session', targetId: body.session ?? 'all', details: body });
    res.json({ ok: true, applied: false, note: 'Stage 1 stub: validated and logged; no live game connected yet.' });
  });

  r.post('/game/spawn', requireAuth, async (req, res) => {
    const body = parse(z.object({ item: z.string().trim().min(1).max(64), tier: z.enum(['approved', 'any', 'developer']).default('approved'), quantity: z.number().int().min(1).max(50).default(1) }), req.body);
    const need = ITEM_TIERS[body.tier];
    if (!hasPermission(req.user!.role, need)) {
      await audit(ctx.db, req, { action: 'game.spawn.denied', category: 'game', details: body });
      throw new HttpError(403, 'You do not have permission to spawn that item.', 'forbidden');
    }
    await audit(ctx.db, req, { action: 'game.spawn', category: 'game', details: body });
    res.json({ ok: true, applied: false, note: 'Stage 1 stub: validated and logged; no live game connected yet.' });
  });

  // Developer-only stubs so the permission wiring exists end-to-end.
  for (const [p, perm] of [['teleport', 'teleport'], ['npc', 'npc.control'], ['dev-command', 'dev.commands']] as const) {
    r.post(`/game/${p}`, requirePermission(perm), async (req, res) => {
      const body = parse(z.record(z.string(), z.unknown()), req.body ?? {});
      await audit(ctx.db, req, { action: `game.${p}`, category: 'game', details: body });
      res.json({ ok: true, applied: false, note: 'Stage 1 stub: validated and logged; no live game connected yet.' });
    });
  }

  // ---------------- Sky Crew flight results (Stage 4) ----------------
  // Results are reported by the player's own browser (honour system, like most web games without
  // an authoritative server-side simulation). Values are clamped and rate-limited to keep the
  // leaderboard sane; staff can delete a user's flights by banning them (banned users are hidden).
  const ROUTES = ['CRP', 'DNB', 'PNR', 'HBF'] as const;
  const LANDINGS = ['butter', 'good', 'hard', 'crash', 'none'] as const;
  const lastPost = new Map<number, number>();
  const FLIGHT_COOLDOWN_MS = 30_000;
  r.post('/game/sky-crew/flights', requireAuth, async (req, res) => {
    if (req.authVia !== 'session') throw new HttpError(403, 'Flights must be reported with a website session');
    const b = parse(z.object({
      score: z.number().int().min(-100000).max(100000), // total payout in credits
      stars: z.number().int().min(0).max(5),
      landing: z.enum(LANDINGS),
      route: z.enum(ROUTES),
      crashed: z.boolean(),
      duration: z.number().int().min(10).max(7200),
      coop: z.boolean().optional(),
    }), req.body);
    const uid = req.user!.id, now = Date.now();
    if (now - (lastPost.get(uid) ?? 0) < FLIGHT_COOLDOWN_MS) throw new HttpError(429, 'Flight already recorded. Try again in a moment.', 'rate_limited');
    lastPost.set(uid, now);
    const id = await insertId(ctx.db('game_flights').insert({ user_id: uid, game_slug: 'sky-crew', score: b.score, stars: b.stars, landing: b.landing, route: b.route, crashed: b.crashed, duration: b.duration, coop: !!b.coop, created_at: new Date().toISOString() }));
    res.status(201).json({ ok: true, id: typeof id === 'object' ? (id as any).id : id, stats: await flightStats(uid) });
  });

  async function flightStats(userId: number) {
    const q = () => ctx.db('game_flights').where({ user_id: userId, game_slug: 'sky-crew' });
    const agg: any = await q().count({ n: '*' }).max({ best: 'score' }).first();
    const landings: any = await q().whereIn('landing', ['butter', 'good', 'hard']).count({ n: '*' }).first();
    const butter: any = await q().where({ landing: 'butter' }).count({ n: '*' }).first();
    const crashes: any = await q().where({ crashed: true }).count({ n: '*' }).first();
    return { flights: Number(agg?.n ?? 0), bestScore: agg?.best == null ? null : Number(agg.best), landings: Number(landings?.n ?? 0), butterLandings: Number(butter?.n ?? 0), crashes: Number(crashes?.n ?? 0) };
  }

  r.get('/games/sky-crew/leaderboard', async (_req, res) => {
    const rows = await ctx.db('game_flights as f')
      .join('users as u', 'u.id', 'f.user_id')
      .where('f.game_slug', 'sky-crew').andWhere('u.banned', false)
      .groupBy('f.user_id', 'u.username', 'u.display_name', 'u.role', 'u.avatar_url')
      .select('u.username', 'u.display_name', 'u.role', 'u.avatar_url')
      .max({ best: 'f.score' }).count({ flights: '*' })
      .orderBy('best', 'desc').limit(10);
    res.json({
      leaderboard: rows.map((x: any, i: number) => ({ rank: i + 1, username: x.username, displayName: x.display_name || x.username, role: x.role, avatarUrl: x.avatar_url || null, bestScore: Number(x.best), flights: Number(x.flights) })),
      note: 'Scores are reported by players\' browsers.',
    });
  });

  r.get('/users/:username/game-stats', async (req, res) => {
    const name = String(req.params.username).toLowerCase().slice(0, 32);
    const u = await ctx.db<UserRow>('users').where({ username_lower: name }).first();
    if (!u || u.banned) throw new HttpError(404, 'Not found');
    res.json({ skyCrew: await flightStats(u.id) });
  });

  return r;
}
