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

  return r;
}
