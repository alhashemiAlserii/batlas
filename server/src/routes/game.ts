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
import { parseStoredOutfit, validOutfit } from '../game-server/outfits.js';
import { CATALOG, SALARY_CAP, MAX_PAID_FLIGHTS_PER_HOUR, outfitAllowed } from '../game-server/shop.js';
import { applyLedger, balanceOf, buyItem, grant, ownedItems, ownsFn, recentLedger } from '../lib/wallet.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { publicUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requireAuth, requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { canActOn, hasPermission, ITEM_TIERS, permissionsFor } from '../lib/permissions.js';
import { insertId } from '../db/index.js';
import { getMaintenance, maintenanceBlocks } from '../lib/maintenance.js';

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
    // Maintenance: only the Developer can join game servers while it's on.
    if (await maintenanceBlocks(ctx.db, u.role)) { const m = await getMaintenance(ctx.db); return res.status(503).json({ valid: false, code: 'maintenance', message: m.message || null }); }
    const prof = await ctx.db('game_profiles').where({ user_id: u.id, game_slug: 'sky-crew' }).first();
    const owned = await ownedItems(ctx.db, u.id, u.role);
    let outfit = parseStoredOutfit(prof?.outfit);
    if (!outfitAllowed(outfit, ownsFn(owned))) outfit = parseStoredOutfit(null); // e.g. an item the Developer took back
    res.json({ valid: true, user: publicUser(u), role: u.role, permissions: permissionsFor(u.role), game: row.game_slug, outfit, owned: owned.keys, ownsAll: owned.all, balance: await balanceOf(ctx.db, u.id) });
  });

  // Sky Crew outfit, saved per account (validated against the server whitelist).
  r.get('/game/sky-crew/outfit', requireAuth, async (req, res) => {
    const prof = await ctx.db('game_profiles').where({ user_id: req.user!.id, game_slug: 'sky-crew' }).first();
    res.json({ outfit: parseStoredOutfit(prof?.outfit), saved: !!prof });
  });
  r.put('/game/sky-crew/outfit', requireAuth, async (req, res) => {
    const o = validOutfit(req.body?.outfit);
    if (!o) throw new HttpError(400, 'Unknown outfit.', 'bad_outfit');
    if (!outfitAllowed(o, ownsFn(await ownedItems(ctx.db, req.user!.id, req.user!.role)))) throw new HttpError(403, 'Buy that item in the shop first.', 'not_owned');
    const row = { user_id: req.user!.id, game_slug: 'sky-crew', outfit: JSON.stringify(o), updated_at: new Date().toISOString() };
    await ctx.db('game_profiles').insert(row).onConflict(['user_id', 'game_slug']).merge(['outfit', 'updated_at']);
    res.json({ ok: true, outfit: o });
  });

  // ---------------- Sky Crew wallet + shop (server-verified; the client only asks) ----------------
  r.get('/game/sky-crew/wallet', requireAuth, async (req, res) => {
    const u = req.user!;
    const owned = await ownedItems(ctx.db, u.id, u.role);
    res.json({ balance: await balanceOf(ctx.db, u.id), owned: owned.keys, ownsAll: owned.all, catalog: CATALOG, ledger: await recentLedger(ctx.db, u.id, 20) });
  });
  r.post('/game/sky-crew/shop/buy', requireAuth, async (req, res) => {
    if (req.authVia !== 'session') throw new HttpError(403, 'Purchases must be made with a website session');
    const b = parse(z.object({ item: z.string().max(48), purchaseId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/) }), req.body);
    const u = req.user!;
    const r2 = await buyItem(ctx.db, u.id, u.role, b.item, b.purchaseId);
    if (!r2.ok) {
      if (r2.code === 'insufficient_funds') await audit(ctx.db, req, { action: 'shop.denied', category: 'game', targetType: 'item', targetId: b.item, details: { reason: 'insufficient_funds', balance: r2.balance, price: r2.price } });
      return res.status(r2.code === 'unknown_item' ? 404 : 402).json({ error: r2.code === 'unknown_item' ? 'Unknown item.' : 'Not enough credits.', code: r2.code, balance: r2.balance, price: r2.price });
    }
    if (!r2.already) await audit(ctx.db, req, { action: 'shop.purchase', category: 'game', targetType: 'item', targetId: b.item, details: { balance: r2.balance, purchaseId: b.purchaseId } });
    res.json(r2);
  });

  const serverKeyOk = (req: import('express').Request) => { const key = req.get('x-game-server-key') ?? ''; if (!ctx.config.gameServerKey || !safeEqual(key, ctx.config.gameServerKey)) throw new HttpError(401, 'Invalid game server key'); };
  // Game server: what does this account own right now (class picks, outfit changes are checked against this)
  r.post('/game/owned', async (req, res) => {
    serverKeyOk(req);
    const { userId } = parse(z.object({ userId: z.number().int().positive() }), req.body);
    const u = await ctx.db<UserRow>('users').where({ id: userId }).first();
    if (!u) throw new HttpError(404, 'Unknown user');
    const owned = await ownedItems(ctx.db, u.id, u.role);
    res.json({ role: u.role, owned: owned.keys, ownsAll: owned.all, balance: await balanceOf(ctx.db, u.id) });
  });
  // Game server: pay the crew of a finished flight. The game server computed the salary from its OWN room
  // tracking; the site caps it, rate-limits paid flights per account and makes every flight key payable once.
  r.post('/game/salary', async (req, res) => {
    serverKeyOk(req);
    const b = parse(z.object({
      flightKey: z.string().min(6).max(100).regex(/^[A-Za-z0-9:._-]+$/),
      userIds: z.array(z.number().int().positive()).min(1).max(8),
      amount: z.number().int().min(0).max(SALARY_CAP),
      lines: z.array(z.tuple([z.string().max(80), z.number()])).max(12).optional(),
      facts: z.record(z.string(), z.unknown()).optional(),
    }), req.body);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const paid: { userId: number; amount: number; balance: number; duplicate?: boolean; refused?: string }[] = [];
    for (const userId of [...new Set(b.userIds)]) {
      const u = await ctx.db<UserRow>('users').where({ id: userId }).first();
      if (!u || u.banned) { paid.push({ userId, amount: 0, balance: 0, refused: 'unknown or banned' }); continue; }
      const recent = await ctx.db('wallet_ledger').where({ user_id: userId, kind: 'salary' }).andWhere('created_at', '>', hourAgo).count({ n: '*' }).first();
      const already = await ctx.db('wallet_ledger').where({ user_id: userId, kind: 'salary', ref: b.flightKey }).first();
      if (!already && Number(recent?.n ?? 0) >= MAX_PAID_FLIGHTS_PER_HOUR) { paid.push({ userId, amount: 0, balance: await balanceOf(ctx.db, userId), refused: 'too many paid flights this hour' }); continue; }
      const r2 = await applyLedger(ctx.db, userId, b.amount, 'salary', b.flightKey, { lines: b.lines ?? [], facts: b.facts ?? {} });
      if (r2.ok) paid.push({ userId, amount: r2.duplicate ? 0 : b.amount, balance: r2.balance, duplicate: r2.duplicate });
      if (r2.ok && !r2.duplicate) await audit(ctx.db, req, { action: 'ingame.salary', category: 'game', targetType: 'user', targetId: userId, targetLabel: u.username, details: { flightKey: b.flightKey, amount: b.amount, facts: b.facts ?? {} } }, u);
    }
    res.json({ paid });
  });
  // Game server: Developer grants/removes credits or items. The actor's rank is re-checked in the DB.
  r.post('/game/grant', async (req, res) => {
    serverKeyOk(req);
    const b = parse(z.object({ actorUserId: z.number().int().positive(), targetUserId: z.number().int().positive(), credits: z.number().int().min(-1_000_000).max(1_000_000).optional(), item: z.string().max(48).optional(), remove: z.boolean().optional() }), req.body);
    const actor = await ctx.db<UserRow>('users').where({ id: b.actorUserId }).first();
    const target = await ctx.db<UserRow>('users').where({ id: b.targetUserId }).first();
    if (!actor || actor.role !== 'DEVELOPER') { if (actor) await audit(ctx.db, req, { action: 'ingame.wallet.denied', category: 'game', targetType: 'user', targetId: b.targetUserId, details: { credits: b.credits, item: b.item } }, actor); throw new HttpError(403, 'Only the Developer can grant credits or items.', 'forbidden'); }
    if (!target) throw new HttpError(404, 'Unknown user');
    let out;
    try { out = await grant(ctx.db, target.id, { credits: b.credits, item: b.item, remove: b.remove }, actor.username); } catch { throw new HttpError(400, 'Unknown item.', 'unknown_item'); }
    await audit(ctx.db, req, { action: 'ingame.wallet.grant', category: 'game', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { credits: out.credits ?? 0, item: b.item ?? null, remove: !!b.remove, balance: out.balance } }, actor);
    res.json({ ok: true, ...out });
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
    const category = /kick|ban|mute|freeze/.test(b.action) ? 'moderation' : 'game';
    await audit(ctx.db, req, { action: b.action, category, targetType: b.targetUserId ? 'user' : 'room', targetId: b.targetUserId ?? (b.details?.room as string | undefined), targetLabel: b.targetLabel, details: b.details }, actor);
    res.json({ ok: true });
  });

  // In-game account ban requested by a game server. The actor's rank is re-checked here against the DB.
  r.post('/game/ban', async (req, res) => {
    const key = req.get('x-game-server-key') ?? '';
    if (!ctx.config.gameServerKey || !safeEqual(key, ctx.config.gameServerKey)) throw new HttpError(401, 'Invalid game server key');
    const b = parse(z.object({ actorUserId: z.number().int().positive(), targetUserId: z.number().int().positive(), reason: z.string().max(200).optional() }), req.body);
    const actor = await ctx.db<UserRow>('users').where({ id: b.actorUserId }).first();
    const target = await ctx.db<UserRow>('users').where({ id: b.targetUserId }).first();
    if (!actor || !target) throw new HttpError(404, 'Unknown user');
    if (actor.banned || !hasPermission(actor.role, 'players.ban')) throw new HttpError(403, 'You do not have permission to do that.', 'forbidden');
    const g = canActOn({ id: actor.id, role: actor.role }, { id: target.id, role: target.role });
    if (!g.ok) throw new HttpError(403, g.reason, 'forbidden');
    await ctx.db.transaction(async (trx) => {
      await trx('users').where({ id: target.id }).update({ banned: true, ban_reason: b.reason ?? null, banned_at: new Date().toISOString() });
      await trx('sessions').where({ user_id: target.id }).delete();
      await trx('game_tokens').where({ user_id: target.id }).delete();
    });
    await audit(ctx.db, req, { action: 'player.ban', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { reason: b.reason ?? null, via: 'sky-crew' } }, actor);
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
