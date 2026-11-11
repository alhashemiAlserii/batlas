/**
 * Sky Crew co-op game server (v0).
 *
 * - WebSocket endpoint: /ws/sky-crew
 * - Every connection must authenticate with a short-lived game token from the website
 *   (POST /api/game/token). The server verifies it with the site and keeps the verified
 *   role/permissions. Anything a client says about its own rank is ignored.
 * - Rooms have a 5-letter code. The room host simulates cabin/passengers/luggage and sends
 *   world snapshots; the current pilot sends aircraft state; the server relays.
 * - Admin commands are validated here (permission map + canActOn), applied to the room and
 *   written to the website audit log.
 */
import { DEFAULT_OUTFIT, validOutfit, type Outfit } from './outfits.js';
import { CLASS_IDS, ITEM_BY_KEY, outfitAllowed } from './shop.js';
import { newFlight, trackSnapshot, salaryFor, type Flight } from './flight-tracker.js';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { SiteBridge, VerifiedUser } from './bridge.js';
import { canActOn, ITEM_TIERS, type ItemTier, type Permission } from '../lib/permissions.js';
import { checkStep, newTerm, type TermState } from './terminal.js';
import { DEV_ITEMS, DEV_CATEGORIES, devItem, MAX_EQUIPPED, WEATHERS, SCENARIOS, TELEPORT_SPOTS, NPC_ACTIONS, ROOM_EVENTS, DIFFICULTIES, MUTE_MINUTES_MAX, BAN_MINUTES_MAX } from './catalog.js';
import { envMaintenance, MAINTENANCE_MESSAGE, type MaintenanceCheck } from './maintenance.js';

export { WEATHERS, SCENARIOS, TELEPORT_SPOTS, NPC_ACTIONS } from './catalog.js';
export const WS_PATH = '/ws/sky-crew';
export const MAX_PLAYERS = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Spawnable world items per tier. Developer-tier items are the secret inventory's tools, spawned as pickups only the Developer can take. */
export const SPAWNABLE: Record<ItemTier, string[]> = {
  approved: ['suitcase', 'duffel', 'water', 'snack', 'blanket'],
  any: ['suitcase', 'duffel', 'water', 'snack', 'blanket', 'beach_ball', 'giant_duck', 'traffic_cone'],
  developer: DEV_ITEMS.filter((i) => i.kind === 'tool').map((i) => i.id),
};
export const CREW_ROLES = ['pilot', 'copilot', 'cabin', 'cargo'] as const;
const UNIQUE_CREW = new Set(['pilot', 'copilot']); // one captain and one first officer per room
const CHAT_MAX = 200;

interface Client {
  cid: string;
  ws: WebSocket;
  user: VerifiedUser | null;
  room: Room | null;
  state: Record<string, unknown> | null;
  crew: (typeof CREW_ROLES)[number] | null;
  hidden: boolean; // Developer invisible spectate
  joinedAt: number;
  bucket: { tokens: number; last: number };
  authed: Promise<void> | null;
  /** Developer secret inventory: what is equipped right now (server-side truth) */
  equipped: Set<string>;
  lastUse: Map<string, number>;
  useCounts: Map<string, number>; // aggregated for the audit log (flushed every few seconds)
  mutedUntil: number;
  frozen: boolean;
  lastChat: number;
  outfit: Outfit;
  lastOutfit: number;
  klass: string | null; // class picked for the next flight (ownership checked with the website)
  term: TermState; // pre-flight airport progress (server truth)
}

interface RoomConfig { difficulty: (typeof DIFFICULTIES)[number]; payout: number; maxPlayers: number }

interface Room {
  code: string;
  hostCid: string;
  pilotCid: string | null;
  clients: Map<string, Client>;
  weather: (typeof WEATHERS)[number];
  hour: number; // time of day (0..24), Developer-controlled
  createdAt: number;
  locked: boolean; // host closed the room to new players
  route: string | null; // last values seen in the host's world snapshot (for the staff room list)
  phase: string | null;
  config: RoomConfig;
  devItems: Set<string>; // ids of Developer-tier pickups spawned in this room
  seq: number;
  flight: Flight | null; // server-side record of the current flight (salaries)
  flightSeq: number;
  airport: boolean; // walk through the pre-flight terminal (host can skip it for quick rounds)
}

type Send = (c: Client, msg: unknown) => void;

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const clampNum = (v: unknown, lim = 1e6) => (isNum(v) ? Math.max(-lim, Math.min(lim, v as number)) : 0);
const vec3 = (v: unknown, lim = 1e5) => (Array.isArray(v) && v.length === 3 && v.every(isNum) ? (v as number[]).map((n) => clampNum(n, lim)) : null);
const cleanText = (v: unknown, max = CHAT_MAX) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Only well-formed numeric/short-string player state is relayed (no client-claimed ranks/names). */
function sanitizeState(s: any): Record<string, unknown> | null {
  if (!s || typeof s !== 'object') return null;
  const p = Array.isArray(s.p) && s.p.length === 3 ? s.p.map((n: unknown) => clampNum(n, 1e5)) : [0, 0, 0];
  return {
    p,
    ry: clampNum(s.ry, 100),
    pt: clampNum(s.pt, 10),
    held: typeof s.held === 'string' ? s.held.slice(0, 32) : null,
    mode: typeof s.mode === 'string' ? s.mode.slice(0, 16) : 'walk',
    moving: !!s.moving,
    run: !!s.run,
    fly: !!s.fly,
  };
}

export interface GameServerOptions {
  bridge: SiteBridge;
  log?: (msg: string) => void;
  /** Shared site maintenance switch (siteMaintenance(db)); defaults to the MAINTENANCE_MODE env fallback. */
  isMaintenance?: MaintenanceCheck;
  /** how often live rooms are checked for maintenance being switched on (ms) */
  maintenancePollMs?: number;
  /** clock (tests) */
  now?: () => number;
}

export function attachGameServer(httpServer: HttpServer, opts: GameServerOptions) {
  const { bridge } = opts;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.log(`[game] ${m}`));
  const isMaintenance = opts.isMaintenance ?? envMaintenance;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  /** game-server bans (userId -> until ms), set by Admin/Developer "ban" from the in-game panel */
  const gameBans = new Map<number, { until: number; by: string; reason: string }>();

  const send: Send = (c, msg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const publicPlayer = (c: Client) => ({ cid: c.cid, username: c.user!.username, displayName: c.user!.displayName, role: c.user!.role, avatarUrl: c.user!.avatarUrl, crew: c.crew, state: c.state, gear: [...c.equipped], frozen: c.frozen, muted: c.mutedUntil > Date.now(), outfit: c.outfit, klass: c.klass, term: c.term.step });
  // Hidden Developers are left out of everyone else's player list.
  const roomInfo = (r: Room, viewer?: Client) => ({ t: 'room', code: r.code, hostCid: r.hostCid, pilotCid: r.pilotCid, weather: r.weather, hour: r.hour, locked: r.locked, config: r.config, airport: r.airport, players: [...r.clients.values()].filter((p) => !p.hidden || p === viewer).map(publicPlayer) });
  const broadcastRoom = (r: Room, except?: Client) => { for (const c of r.clients.values()) if (c !== except) send(c, roomInfo(r, c)); };
  /** Developer rank, as verified by the website for this connection's game token (never client claims). */
  const isDev = (c: Client) => !!c.user && c.user.role === 'DEVELOPER';
  const broadcast = (r: Room, msg: unknown, except?: Client) => {
    const data = JSON.stringify(msg);
    for (const c of r.clients.values()) if (c !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };
  const can = (c: Client, p: Permission) => !!c.user && c.user.permissions.includes(p);
  /** The secret inventory: verified Developer rank AND the developer item permission. Admin/Trusted never pass. */
  const devInv = (c: Client) => isDev(c) && can(c, ITEM_TIERS.developer);
  const actor = (c: Client) => ({ id: c.user!.userId, role: c.user!.role });

  function newCode() {
    for (;;) {
      const bytes = crypto.randomBytes(5);
      const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!rooms.has(code)) return code;
    }
  }

  function leaveRoom(c: Client, reason = 'left') {
    const r = c.room;
    if (!r) return;
    flushUses(c);
    r.clients.delete(c.cid);
    const wasHidden = c.hidden;
    c.room = null;
    c.state = null;
    c.crew = null;
    c.hidden = false;
    c.frozen = false;
    c.equipped.clear();
    if (r.clients.size === 0) {
      rooms.delete(r.code);
      log(`room ${r.code} closed`);
      return;
    }
    if (r.pilotCid === c.cid) r.pilotCid = null;
    if (r.hostCid === c.cid) {
      // promote the longest-connected remaining (visible) player; Map order = join order
      const next = [...r.clients.values()].find((o) => !o.hidden) ?? r.clients.values().next().value!;
      r.hostCid = next.cid;
      log(`room ${r.code} host -> ${r.hostCid}`);
    }
    if (!wasHidden) broadcast(r, { t: 'left', cid: c.cid, reason });
    broadcastRoom(r);
  }

  function joinRoom(c: Client, r: Room, opts: { hidden?: boolean; created?: boolean } = {}) {
    const dev = isDev(c);
    const visible = [...r.clients.values()].filter((o) => !o.hidden).length;
    const bypass: string[] = [];
    if (!opts.created && visible >= r.config.maxPlayers) { if (!dev) return send(c, { t: 'error', code: 'room_full', message: 'That room is full.' }); bypass.push('full'); }
    if (!opts.created && r.locked) { if (!dev) return send(c, { t: 'error', code: 'room_locked', message: 'That room is locked by its host.' }); bypass.push('locked'); }
    if (c.room) leaveRoom(c);
    c.hidden = dev && !!opts.hidden && !opts.created;
    c.joinedAt = Date.now();
    r.clients.set(c.cid, c);
    c.room = r;
    c.term = newTerm(now());
    send(c, { ...roomInfo(r, c), you: c.cid, hidden: c.hidden });
    if (!c.hidden) broadcast(r, { t: 'joined', player: publicPlayer(c) }, c);
    broadcastRoom(r, c);
    if (dev && !opts.created) void audit(c, 'dev.join', { hidden: c.hidden, bypass, players: visible });
  }
  /** Developer-only overview of every live room. */
  function roomList() {
    return [...rooms.values()].map((r) => {
      const host = r.clients.get(r.hostCid);
      const ps = [...r.clients.values()];
      return {
        code: r.code, host: host?.user?.username ?? null, locked: r.locked, route: r.route, phase: r.phase, weather: r.weather, hour: r.hour, config: r.config, createdAt: new Date(r.createdAt).toISOString(),
        count: ps.filter((p) => !p.hidden).length, max: r.config.maxPlayers,
        players: ps.map((p) => ({ cid: p.cid, username: p.user!.username, role: p.user!.role, crew: p.crew, hidden: p.hidden, host: p.cid === r.hostCid })),
      };
    });
  }

  async function audit(c: Client, cmd: string, details: Record<string, unknown>, target?: Client) {
    try {
      await bridge.audit({
        actorUserId: c.user!.userId,
        action: `ingame.${cmd}`,
        targetUserId: target?.user?.userId,
        targetLabel: target?.user?.username,
        details: { room: c.room?.code, game: 'sky-crew', ...details },
      });
    } catch (e) {
      log(`audit error: ${(e as Error).message}`);
    }
  }
  /** Weapon/ability uses are summed and written to the audit log in batches (one row per item per flush). */
  function flushUses(c: Client) {
    if (!c.user || !c.useCounts.size) return;
    const uses = Object.fromEntries(c.useCounts);
    c.useCounts.clear();
    void audit(c, 'dev.use', { uses });
  }

  /** Removes a client from the game with a reason screen (kick / ban / maintenance / room closed). */
  function eject(c: Client, t: 'kicked' | 'maintenance', payload: Record<string, unknown>, code = 4001) {
    send(c, { t, ...payload });
    leaveRoom(c, t === 'maintenance' ? 'maintenance' : 'kicked');
    setTimeout(() => c.ws.close(code, t), 50);
  }

  /** Rank-checked action on another player in the room. Logs denials. */
  async function guardTarget(c: Client, cmd: string, target: Client | undefined): Promise<string | null> {
    if (!target) return 'Player not found in this room.';
    if (isDev(target)) { await audit(c, `${cmd}.denied`, { reason: 'developer' }, target); return 'The Developer is protected.'; }
    const g = canActOn(actor(c), actor(target));
    if (!g.ok) { await audit(c, `${cmd}.denied`, { reason: g.reason }, target); return g.reason; }
    return null;
  }

  /** Validates and applies an admin command. Returns an error string or null on success. */
  /** What this account owns right now (asked from the website each time: purchases can happen mid-session). */
  async function ownsOf(c: Client): Promise<(k: string) => boolean> {
    if (isDev(c)) return () => true; // the Developer owns everything
    const o = bridge.owned ? await bridge.owned(c.user!.userId).catch(() => null) : null;
    const keys = new Set(o?.owned ?? c.user!.owned ?? []);
    for (const i of ITEM_BY_KEY.values()) if (i.price === 0) keys.add(i.key);
    return (k: string) => !!o?.ownsAll || keys.has(k);
  }
  async function paySalaries(r: Room, f: Flight, w: any) {
    f.paid = true;
    const sal = salaryFor(f, w, r.config.payout);
    const present = [...r.clients.values()].filter((o) => o.user && !o.hidden);
    const skipped = present.filter((o) => f.unboarded?.has(o.user!.userId));
    for (const o of skipped) send(o, { t: 'salary', amount: 0, reason: 'You skipped the airport (no boarding pass), so this flight is not on your payslip.' });
    const crew = present.filter((o) => f.crew.get(o.cid) === o.user!.userId && !skipped.includes(o));
    for (const o of present) if (!crew.includes(o) && !skipped.includes(o)) send(o, { t: 'salary', amount: 0, reason: 'You joined after takeoff, so this flight is not on your payslip.' });
    if (sal.rejected || !crew.length) {
      for (const o of crew) send(o, { t: 'salary', amount: 0, reason: `No salary: ${sal.rejected ?? 'no crew'}.`, facts: sal.facts });
      const host = r.clients.get(r.hostCid);
      if (host?.user) void audit(host, 'salary.rejected', { flight: f.key, reason: sal.rejected, facts: sal.facts });
      return;
    }
    const res = bridge.salary ? await bridge.salary({ flightKey: f.key, userIds: crew.map((o) => o.user!.userId), amount: sal.amount, lines: sal.lines, facts: sal.facts }).catch(() => null) : null;
    for (const o of crew) {
      const p = res?.paid.find((x) => x.userId === o.user!.userId);
      send(o, p && !p.refused ? { t: 'salary', amount: p.amount, balance: p.balance, lines: sal.lines, duplicate: !!p.duplicate, facts: sal.facts }
        : { t: 'salary', amount: 0, reason: p?.refused ? `No salary: ${p.refused}.` : 'The wallet service did not answer; this flight was not paid.', facts: sal.facts });
    }
  }

  async function adminCommand(c: Client, cmd: string, args: any): Promise<string | null> {
    const r = c.room;
    args = args && typeof args === 'object' ? args : {};
    // server-wide Developer tools work outside a room too
    if (cmd === 'broadcast') {
      if (!isDev(c) || !can(c, 'dev.commands')) { await audit(c, 'broadcast.denied', {}); return 'Only the Developer can broadcast.'; }
      const text = cleanText(args.text);
      if (!text) return 'Write a message first.';
      for (const o of clients) if (o.user) send(o, { t: 'announce', text, by: c.user!.username });
      await audit(c, 'broadcast', { text, rooms: rooms.size });
      return null;
    }
    if (cmd === 'close_room') {
      if (!isDev(c) || !can(c, 'dev.commands')) { await audit(c, 'close_room.denied', {}); return 'Only the Developer can close rooms.'; }
      const room = rooms.get(String(args.code ?? '').toUpperCase());
      if (!room) return 'No room with that code.';
      const ps = [...room.clients.values()];
      for (const o of ps) {
        if (o === c) { leaveRoom(o, 'closed'); send(o, { t: 'room_left', reason: 'closed' }); continue; }
        send(o, { t: 'kicked', by: c.user!.username, reason: 'The Developer closed this room.' });
        leaveRoom(o, 'closed');
      }
      rooms.delete(room.code);
      await audit(c, 'close_room', { code: room.code, players: ps.length });
      return null;
    }
    if (!r) return 'Join a room first.';
    const by = { cid: c.cid, username: c.user!.username, role: c.user!.role };
    const fx = (extra: Record<string, unknown> = {}, base = args) => broadcast(r, { t: 'fx', cmd, args: { ...base, ...extra }, by });
    const target = typeof args.cid === 'string' ? r.clients.get(args.cid) : undefined;

    switch (cmd) {
      case 'spawn': {
        const tier = (['approved', 'any', 'developer'] as const).includes(args.tier) ? (args.tier as ItemTier) : 'approved';
        if (tier === 'developer' ? !devInv(c) : !can(c, ITEM_TIERS[tier])) { await audit(c, 'spawn.denied', { tier, item: String(args.item ?? '').slice(0, 32) }); return 'Your rank cannot spawn that.'; }
        if (!SPAWNABLE[tier].includes(args.item)) return 'Unknown item for that tier.';
        const count = Math.max(1, Math.min(5, Math.floor(Number(args.count) || 1)));
        // Developer pickups get server-issued ids so the server can refuse anyone else grabbing them.
        const ids = tier === 'developer' ? Array.from({ length: count }, () => { const id = `dv${++r.seq}`; r.devItems.add(id); return id; }) : undefined;
        fx({ tier, item: args.item, count, ids }, { tier, item: args.item });
        await audit(c, 'spawn', { tier, item: args.item, count });
        return null;
      }
      case 'kick': {
        if (!can(c, 'players.kick')) { await audit(c, 'kick.denied', { reason: 'rank' }, target); return 'Your rank cannot kick players.'; }
        const g = await guardTarget(c, 'kick', target); if (g) return g;
        const reason = cleanText(args.reason);
        await audit(c, 'kick', { reason }, target);
        eject(target!, 'kicked', { by: c.user!.username, reason });
        return null;
      }
      case 'ban': {
        if (!can(c, 'players.ban')) { await audit(c, 'ban.denied', { reason: 'rank' }, target); return 'Your rank cannot ban players.'; }
        const g = await guardTarget(c, 'ban', target); if (g) return g;
        const reason = cleanText(args.reason);
        const minutes = Math.max(1, Math.min(BAN_MINUTES_MAX, Math.floor(Number(args.minutes) || 60)));
        const site = args.scope === 'site';
        if (site) {
          // account ban on the website: the site re-checks the actor's rank against its own database
          if (!bridge.ban) return 'Site bans are not available on this server.';
          const res = await bridge.ban({ actorUserId: c.user!.userId, targetUserId: target!.user!.userId, reason });
          if (!res.ok) return res.reason ?? 'The website refused the ban.';
        } else gameBans.set(target!.user!.userId, { until: Date.now() + minutes * 60_000, by: c.user!.username, reason });
        await audit(c, 'ban', { reason, scope: site ? 'site' : 'game', minutes: site ? null : minutes }, target);
        eject(target!, 'kicked', { by: c.user!.username, reason, banned: true, minutes: site ? null : minutes });
        return null;
      }
      case 'mute': {
        if (!can(c, 'players.kick')) { await audit(c, 'mute.denied', { reason: 'rank' }, target); return 'Your rank cannot mute players.'; }
        const g = await guardTarget(c, 'mute', target); if (g) return g;
        const minutes = args.on === false ? 0 : Math.max(1, Math.min(MUTE_MINUTES_MAX, Math.floor(Number(args.minutes) || 10)));
        target!.mutedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
        send(target!, { t: 'muted', minutes, by: c.user!.username });
        broadcastRoom(r);
        await audit(c, minutes ? 'mute' : 'unmute', { minutes }, target);
        return null;
      }
      case 'wallet': {
        // Developer only: grant/remove credits, grant/remove shop items (the website re-checks the rank and logs it)
        if (!isDev(c) || !can(c, 'dev.commands')) { await audit(c, 'wallet.denied', { credits: args.credits, item: args.item }, target); return 'Only the Developer can grant credits or items.'; }
        if (!target?.user) return 'Pick a player.';
        if (!bridge.grant) return 'Wallet service unavailable.';
        const credits = args.credits == null ? undefined : Math.trunc(Number(args.credits));
        if (credits !== undefined && (!Number.isFinite(credits) || Math.abs(credits) > 1_000_000)) return 'Bad amount.';
        const item = args.item == null ? undefined : String(args.item);
        if (item !== undefined && !ITEM_BY_KEY.has(item)) return 'Unknown item.';
        const g = await bridge.grant({ actorUserId: c.user!.userId, targetUserId: target.user.userId, credits, item, remove: !!args.remove });
        if (!g.ok) return g.reason ?? 'Refused.';
        send(target, { t: 'wallet', balance: g.balance, by: c.user!.username, credits: g.credits ?? 0, item: g.item ?? null, removed: !!g.removed });
        if (item && args.remove && target.klass && item === `class:${target.klass}`) { target.klass = null; broadcastRoom(r!); }
        return null;
      }
      case 'freeze': {
        if (!can(c, 'dev.commands')) { await audit(c, 'freeze.denied', { reason: 'rank' }, target); return 'Only the Developer can freeze players.'; }
        const g = await guardTarget(c, 'freeze', target); if (g) return g;
        target!.frozen = args.on !== false;
        fx({ cid: target!.cid, on: target!.frozen });
        broadcastRoom(r);
        await audit(c, target!.frozen ? 'freeze' : 'unfreeze', {}, target);
        return null;
      }
      case 'weather': {
        if (!can(c, 'weather.change')) { await audit(c, 'weather.denied', {}); return 'Your rank cannot change the weather.'; }
        if (!WEATHERS.includes(args.weather)) return 'Unknown weather.';
        r.weather = args.weather;
        fx({ weather: r.weather }, {});
        await audit(c, 'weather', { weather: args.weather });
        return null;
      }
      case 'time': {
        if (!can(c, 'environment.control')) { await audit(c, 'time.denied', {}); return 'Only the Developer can change the time of day.'; }
        const hour = Number(args.hour);
        if (!Number.isFinite(hour) || hour < 0 || hour > 24) return 'Hour must be between 0 and 24.';
        r.hour = Math.round(hour * 4) / 4;
        fx({ hour: r.hour }, {});
        await audit(c, 'time', { hour: r.hour });
        return null;
      }
      case 'emergency': {
        if (!can(c, 'emergency.trigger')) { await audit(c, 'emergency.denied', {}); return 'Your rank cannot trigger emergencies.'; }
        if (!SCENARIOS.includes(args.scenario)) return 'Unknown scenario.';
        const action = args.action === 'stop' ? 'stop' : 'start';
        if (action === 'stop' && !can(c, 'emergency.manage')) return 'Your rank cannot stop emergencies.';
        fx({ scenario: args.scenario, action }, {});
        await audit(c, `emergency.${action}`, { scenario: args.scenario });
        return null;
      }
      case 'event': {
        if (!can(c, 'events.control')) { await audit(c, 'event.denied', {}); return 'Only the Developer can start events.'; }
        if (!ROOM_EVENTS.includes(args.event)) return 'Unknown event.';
        fx({ event: args.event }, {});
        await audit(c, 'event', { event: args.event });
        return null;
      }
      case 'config': {
        if (!can(c, 'games.manage')) { await audit(c, 'config.denied', {}); return 'Only the Developer can change the game config.'; }
        const next = { ...r.config };
        if (args.difficulty !== undefined) { if (!DIFFICULTIES.includes(args.difficulty)) return 'Unknown difficulty.'; next.difficulty = args.difficulty; }
        if (args.payout !== undefined) { const p = Number(args.payout); if (!Number.isFinite(p) || p < 0.5 || p > 3) return 'Payout multiplier must be 0.5 to 3.'; next.payout = Math.round(p * 4) / 4; }
        if (args.maxPlayers !== undefined) { const m = Math.floor(Number(args.maxPlayers)); if (!Number.isFinite(m) || m < 1 || m > MAX_PLAYERS) return `Max players must be 1 to ${MAX_PLAYERS}.`; next.maxPlayers = m; }
        r.config = next;
        fx({ config: next }, {});
        broadcastRoom(r);
        await audit(c, 'config', { ...next });
        return null;
      }
      case 'teleport': {
        if (!can(c, 'teleport')) { await audit(c, 'teleport.denied', {}); return 'Only the Developer can teleport.'; }
        // modes: { to: spot [, cid] } | { toPlayer: cid } (me -> them) | { bring: cid } (them -> me)
        let who = c, p: number[] | null = null, to: string | null = null;
        const other = (id: unknown) => (typeof id === 'string' ? r.clients.get(id) : undefined);
        if (args.toPlayer !== undefined) {
          const t = other(args.toPlayer); if (!t || t === c) return 'Player not found in this room.';
          p = vec3(t.state?.p); if (!p) return 'That player has no position yet.';
        } else if (args.bring !== undefined) {
          const t = other(args.bring); if (!t || t === c) return 'Player not found in this room.';
          const g = canActOn(actor(c), actor(t)); if (!g.ok) return g.reason;
          who = t; p = vec3(c.state?.p); if (!p) return 'You have no position yet.';
        } else {
          if (!(TELEPORT_SPOTS as readonly string[]).includes(args.to)) return 'Unknown destination.';
          to = args.to;
          if (target && target !== c) { const g = canActOn(actor(c), actor(target)); if (!g.ok) return g.reason; who = target; }
        }
        if (p) p = [p[0] + 0.8, p[1], p[2]]; // land beside them, not inside them
        if (isDev(c) && who.term.step !== 'boarded') { who.term = { step: 'boarded', at: now() }; void audit(c, 'terminal.dev_skip', {}, who === c ? undefined : who); broadcastRoom(r!); } // the Developer teleports past the airport
        fx({ cid: who.cid, to, p }, {});
        await audit(c, 'teleport', { to: to ?? 'player', mode: args.toPlayer ? 'to_player' : args.bring ? 'bring' : 'spot' }, who === c ? (args.toPlayer ? other(args.toPlayer) : undefined) : who);
        return null;
      }
      case 'npc': {
        if (!can(c, 'npc.control')) { await audit(c, 'npc.denied', {}); return 'Only the Developer can control NPCs.'; }
        if (!NPC_ACTIONS.includes(args.action)) return 'Unknown NPC action.';
        const count = Math.max(1, Math.min(8, Math.floor(Number(args.count) || 1)));
        fx({ action: args.action, count }, {});
        await audit(c, 'npc', { action: args.action, count });
        return null;
      }
      case 'equip':
      case 'unequip': {
        if (!devInv(c)) { await audit(c, `${cmd}.denied`, { item: String(args.item ?? '').slice(0, 32) }); return 'Unknown command.'; }
        const it = devItem(args.item); if (!it) return 'Unknown item.';
        const removed: string[] = [];
        if (cmd === 'equip') {
          if (c.equipped.has(it.id)) return null;
          if (it.kind === 'tool') for (const e of c.equipped) if (devItem(e)?.kind === 'tool') { c.equipped.delete(e); removed.push(e); } // one tool in the hand
          if (c.equipped.size >= MAX_EQUIPPED) return 'Too many items equipped.';
          c.equipped.add(it.id);
        } else {
          if (!c.equipped.delete(it.id)) return null;
          flushUses(c);
        }
        broadcast(r, { t: 'fx', cmd: 'equip', args: { cid: c.cid, item: it.id, on: cmd === 'equip', removed, gear: [...c.equipped] }, by });
        await audit(c, `dev.${cmd}`, { item: it.id, gear: [...c.equipped] });
        return null;
      }
      case 'use': {
        if (!devInv(c)) { await audit(c, 'use.denied', { item: String(args.item ?? '').slice(0, 32) }); return 'Unknown command.'; }
        const it = devItem(args.item); if (!it || it.kind !== 'tool') return 'Unknown item.';
        if (!c.equipped.has(it.id)) return 'Equip it first.';
        const now = Date.now(), last = c.lastUse.get(it.id) ?? 0;
        if (now - last < it.cooldown * 1000 * 0.9) return 'Cooling down.';
        c.lastUse.set(it.id, now);
        const o = vec3(args.o), d = vec3(args.d, 2);
        if (!o || !d) return 'Bad aim.';
        const len = Math.hypot(d[0], d[1], d[2]); if (len < 0.5) return 'Bad aim.';
        const dir = d.map((v) => v / len);
        const out: Record<string, unknown> = { cid: c.cid, item: it.id, o, d: dir, mode: args.mode === 'grow' ? 'grow' : args.mode === 'shrink' ? 'shrink' : args.mode === 'launch' ? 'launch' : null, n: now % 100000 };
        // optional target (a passenger id, an item id or a player cid)
        if (args.target && typeof args.target === 'object') {
          const kind = ['pax', 'item', 'player'].includes(args.target.type) ? args.target.type : null;
          if (kind === 'player') {
            const t = r.clients.get(String(args.target.id));
            if (!t || t === c) return 'Player not found in this room.';
            if (isDev(t)) return 'The Developer is protected.';
            out.target = { type: 'player', id: t.cid };
          } else if (kind) out.target = { type: kind, id: kind === 'pax' ? Math.floor(Number(args.target.id)) || 0 : String(args.target.id).slice(0, 32) };
        }
        if (it.id === 'teleport_gun') {
          const p = vec3(args.p); if (!p) return 'Aim at a spot.';
          const from = vec3(c.state?.p) ?? o;
          if (Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) > 80) return 'Too far.';
          out.p = p;
        } else if (args.p) out.p = vec3(args.p);
        broadcast(r, { t: 'fx', cmd: 'use', args: out, by });
        c.useCounts.set(it.id, (c.useCounts.get(it.id) ?? 0) + 1);
        return null;
      }
      default:
        return 'Unknown command.';
    }
  }

  function allow(c: Client) {
    const now = Date.now();
    const b = c.bucket;
    b.tokens = Math.min(120, b.tokens + ((now - b.last) / 1000) * 60);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** maintenance message to show, or null when the game is open */
  async function maintenanceMsg(): Promise<string | null> {
    try { const m = await isMaintenance(); return m.on ? (m.message ? `${MAINTENANCE_MESSAGE} ${m.message}` : MAINTENANCE_MESSAGE) : null; } catch (e) { log(`maintenance check failed: ${(e as Error).message}`); return null; }
  }

  async function onMessage(c: Client, raw: string) {
    if (!allow(c)) return;
    let m: any;
    try {
      m = JSON.parse(raw);
    } catch {
      return send(c, { t: 'error', code: 'bad_json' });
    }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'auth') {
      if (c.user || c.authed) return;
      if (typeof m.token !== 'string' || m.token.length > 200) return fail('auth_failed');
      c.authed = (async () => {
        let u: Awaited<ReturnType<SiteBridge['verify']>> = null;
        try {
          u = await bridge.verify(m.token);
        } catch (e) {
          log(`verify error ${(e as Error).message}`);
        }
        const refuseMaint = (message: string) => { send(c, { t: 'maintenance', message }); setTimeout(() => c.ws.close(4005, 'maintenance'), 20); };
        if (u && 'maintenance' in u) return refuseMaint(u.message ? `${MAINTENANCE_MESSAGE} ${u.message}` : MAINTENANCE_MESSAGE); // the site refused (non-Developer)
        if (!u) return fail('auth_failed');
        const mm = u.role !== 'DEVELOPER' ? await maintenanceMsg() : null;
        if (mm) {
          send(c, { t: 'maintenance', message: mm });
          setTimeout(() => c.ws.close(4005, 'maintenance'), 20);
          return;
        }
        const ban = gameBans.get(u.userId);
        if (ban && ban.until > Date.now() && u.role !== 'DEVELOPER') {
          send(c, { t: 'error', code: 'banned', message: `You are banned from Sky Crew for ${Math.ceil((ban.until - Date.now()) / 60000)} more minute(s).${ban.reason ? ` Reason: ${ban.reason}` : ''}` });
          setTimeout(() => c.ws.close(4004, 'banned'), 20);
          return;
        }
        c.user = u; // the ONLY source of name/rank/permissions
        if (u.outfit) c.outfit = u.outfit;
        send(c, { t: 'welcome', you: { cid: c.cid, username: u.username, displayName: u.displayName, role: u.role, permissions: u.permissions, avatarUrl: u.avatarUrl, outfit: c.outfit, balance: u.balance ?? 0 } });
      })();
      return;
    }
    if (!c.user) return send(c, { t: 'error', code: 'auth_required', message: 'Sign in first.' });

    const r = c.room;
    switch (m.t) {
      case 'ping':
        return send(c, { t: 'pong', at: m.at });
      case 'create': {
        { const mm = isDev(c) ? null : await maintenanceMsg(); if (mm) return send(c, { t: 'maintenance', message: mm }); }
        const room: Room = { code: newCode(), hostCid: c.cid, pilotCid: null, clients: new Map(), weather: 'clear', hour: 13, createdAt: Date.now(), locked: false, route: null, phase: null, config: { difficulty: 'normal', payout: 1, maxPlayers: MAX_PLAYERS }, devItems: new Set(), seq: 0, flight: null, flightSeq: 0, airport: true };
        rooms.set(room.code, room);
        log(`room ${room.code} created by ${c.user.username}`);
        return joinRoom(c, room, { created: true });
      }
      case 'join': {
        { const mm = isDev(c) ? null : await maintenanceMsg(); if (mm) return send(c, { t: 'maintenance', message: mm }); }
        const code = String(m.code ?? '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(c, { t: 'error', code: 'no_room', message: 'No room with that code.' });
        if (m.hidden && !isDev(c)) return send(c, { t: 'error', code: 'forbidden', message: 'Only the Developer can join hidden.' });
        return joinRoom(c, room, { hidden: !!m.hidden });
      }
      case 'rooms': {
        // Live room list: Developer only, decided by the rank the website verified for this socket.
        if (!isDev(c)) { void audit(c, 'rooms.denied', {}); return send(c, { t: 'error', code: 'forbidden', message: 'Only the Developer can see every room.' }); }
        return send(c, { t: 'rooms', rooms: roomList() });
      }
      case 'inventory': {
        // The secret inventory catalogue is only ever sent to the verified Developer.
        if (!devInv(c)) { void audit(c, 'inventory.denied', {}); return send(c, { t: 'error', code: 'forbidden', message: 'Unknown command.' }); }
        return send(c, { t: 'inventory', categories: DEV_CATEGORIES, items: DEV_ITEMS, equipped: [...c.equipped] });
      }
      case 'lock': {
        if (!r || r.hostCid !== c.cid) return send(c, { t: 'error', code: 'not_host', message: 'Only the host can lock the room.' });
        r.locked = !!m.on;
        return broadcastRoom(r);
      }
      case 'leave':
        leaveRoom(c);
        return send(c, { t: 'room_left' });
      case 'st': {
        if (!r) return;
        const s = sanitizeState(m.s);
        if (!s) return;
        // frozen by the Developer: the server keeps the old position (only looking around is relayed)
        if (c.frozen && c.state) { s.p = c.state.p; s.moving = false; s.run = false; s.fly = false; }
        c.state = s;
        if (c.hidden) return; // invisible spectator: nobody sees them move
        return broadcast(r, { t: 'st', cid: c.cid, s }, c);
      }
      case 'chat': {
        if (!r) return;
        if (c.mutedUntil > Date.now()) return send(c, { t: 'error', code: 'muted', message: `You are muted for ${Math.ceil((c.mutedUntil - Date.now()) / 60000)} more minute(s).` });
        const now = Date.now(); if (now - c.lastChat < 700) return; c.lastChat = now;
        const text = cleanText(m.text);
        if (!text || c.hidden) return;
        return broadcast(r, { t: 'chat', cid: c.cid, username: c.user.username, role: c.user.role, text });
      }
      case 'world':
        if (!r || r.hostCid !== c.cid) return; // only the host's simulation counts
        if (raw.length > 48 * 1024) return;
        if (m.w && typeof m.w === 'object') {
          r.route = typeof m.w.route === 'string' ? m.w.route.slice(0, 8) : r.route; r.phase = typeof m.w.ph === 'string' ? m.w.ph.slice(0, 16) : r.phase;
          const seed = Number(m.w.seed);
          if (Number.isFinite(seed) && (!r.flight || r.flight.seed !== seed || (r.flight.paid && m.w.ph === 'boarding'))) {
            r.flight = newFlight(r.code, seed, ++r.flightSeq);
            for (const o of r.clients.values()) o.term = newTerm(now()); // a new flight: everyone starts at the terminal entrance again
            broadcastRoom(r);
          }
          if (r.flight) {
            const crewNow = new Map([...r.clients.values()].filter((o) => o.user && !o.hidden).map((o) => [o.cid, o.user!.userId] as [string, number]));
            const wasAirborne = !!r.flight.airborneAt;
            const res = trackSnapshot(r.flight, m.w, now(), crewNow);
            if (!wasAirborne && r.flight.airborneAt && r.airport) {
              // took off: anyone who did not board through the terminal is not on this flight's payslip
              const skipped = [...r.clients.values()].filter((o) => o.user && !o.hidden && o.term.step !== 'boarded');
              r.flight.unboarded = new Set(skipped.map((o) => o.user!.userId));
              if (skipped.length) void audit(c, 'terminal.depart_unboarded', { flight: r.flight.key, players: skipped.map((o) => o.user!.username) });
            }
            if (res === 'results') void paySalaries(r, r.flight, m.w);
          }
        }
        return broadcast(r, { t: 'world', w: m.w }, c);
      case 'pilot': {
        if (!r || c.hidden) return;
        if (m.on) {
          if (c.frozen) return send(c, { t: 'error', code: 'frozen', message: 'You are frozen.' });
          if (r.pilotCid && r.pilotCid !== c.cid) return send(c, { t: 'error', code: 'seat_taken', message: 'Someone else is flying.' });
          r.pilotCid = c.cid;
        } else if (r.pilotCid === c.cid) r.pilotCid = null;
        return broadcastRoom(r);
      }
      case 'outfit': {
        // outfit change (lobby or mid-flight): whitelist-checked, rate-limited, then shown to the room
        const o = validOutfit(m.outfit);
        if (!o) return send(c, { t: 'error', code: 'bad_outfit', message: 'Unknown outfit.' });
        if (Date.now() - c.lastOutfit < 400) return;
        c.lastOutfit = Date.now();
        if (!outfitAllowed(o, await ownsOf(c))) { void audit(c, 'outfit.denied', { outfit: o }); return send(c, { t: 'error', code: 'not_owned', message: 'Buy that item in the shop first.' }); }
        c.outfit = o;
        if (r && !c.hidden) broadcast(r, { t: 'outfit', cid: c.cid, outfit: o });
        return send(c, { t: 'outfit', cid: c.cid, outfit: o });
      }
      case 'term': {
        // airport step: in order, at the right desk, at human speed (see terminal.ts)
        if (!r || c.hidden) return;
        if (!r.airport) return send(c, { t: 'error', code: 'term_off', message: 'The airport is skipped this round.' });
        if (r.phase && r.phase !== 'boarding') return send(c, { t: 'error', code: 'term_late', message: 'The plane has already left the gate.' });
        const e = checkStep(c.term, m.step, vec3(c.state?.p), now());
        if (e) { if (e.code === 'term_order' || e.code === 'term_bad') void audit(c, 'terminal.denied', { step: String(m.step).slice(0, 16), at: c.term.step, reason: e.code }); return send(c, { t: 'error', ...e }); }
        c.term = { step: m.step, at: now() };
        send(c, { t: 'term', cid: c.cid, step: m.step });
        return broadcastRoom(r);
      }
      case 'airport': {
        // host (or the Developer) chooses whether this round walks through the terminal
        if (!r) return;
        if (r.hostCid !== c.cid && !isDev(c)) return send(c, { t: 'error', code: 'not_host', message: 'Only the host can change that.' });
        if (r.phase && r.phase !== 'boarding') return send(c, { t: 'error', code: 'term_late', message: 'The plane has already left the gate.' });
        r.airport = !m.skip;
        return broadcastRoom(r);
      }
      case 'class': {
        // class pick for the next flight: must be OWNED (checked with the website) and picked before takeoff
        const id = m.id == null ? null : String(m.id);
        if (id !== null && !CLASS_IDS.includes(id)) { void audit(c, 'class.denied', { id: id.slice(0, 32), reason: 'unknown' }); return send(c, { t: 'error', code: 'bad_class', message: 'Unknown class.' }); }
        if (r && r.flight?.airborneAt && !r.flight.resultsAt) return send(c, { t: 'error', code: 'class_locked', message: 'Pick your class before takeoff.' });
        if (id && !(await ownsOf(c))(`class:${id}`)) { void audit(c, 'class.denied', { id, reason: 'not_owned' }); return send(c, { t: 'error', code: 'not_owned', message: 'Buy that class in the shop first.' }); }
        c.klass = id;
        send(c, { t: 'class', cid: c.cid, id });
        if (r) broadcastRoom(r);
        return;
      }
      case 'crew': {
        // lobby role pick: pilot / copilot / cabin / cargo (null = no preference)
        if (!r || c.hidden) return;
        const role = m.role == null ? null : String(m.role);
        if (role !== null && !(CREW_ROLES as readonly string[]).includes(role)) return send(c, { t: 'error', code: 'bad_crew', message: 'Unknown crew role.' });
        if (role && UNIQUE_CREW.has(role) && [...r.clients.values()].some((o) => o !== c && o.crew === role)) return send(c, { t: 'error', code: 'crew_taken', message: `Someone already picked ${role === 'pilot' ? 'Pilot' : 'Co-pilot'}.` });
        c.crew = role as Client['crew'];
        return broadcastRoom(r);
      }
      case 'plane':
        if (!r || r.pilotCid !== c.cid) return; // only the seated pilot controls the aircraft
        return broadcast(r, { t: 'plane', s: m.s }, c);
      case 'act': {
        // gameplay requests (grab/drop/serve/door/fix) go to the host who owns the simulation
        if (!r || c.hidden) return; // spectators don't touch the world
        if (c.frozen) return; // frozen players can't interact
        // Developer pickups: nobody else may take them (the server checks the id it issued)
        if (m.a && typeof m.a === 'object' && typeof m.a.id === 'string' && r.devItems.has(m.a.id) && !devInv(c)) { void audit(c, 'grab.denied', { item: m.a.id }); return; }
        const host = r.clients.get(r.hostCid);
        if (host && host !== c) send(host, { t: 'act', cid: c.cid, a: m.a });
        return;
      }
      case 'event':
        // host-originated gameplay events (results, chat-like notices) relayed to everyone
        if (!r || r.hostCid !== c.cid) return;
        return broadcast(r, { t: 'event', e: m.e }, c);
      case 'admin': {
        const err = await adminCommand(c, String(m.cmd ?? '').slice(0, 32), m.args);
        return send(c, err ? { t: 'admin_denied', cmd: m.cmd, reason: err } : { t: 'admin_ok', cmd: m.cmd });
      }
      default:
        return;
    }

    function fail(code: string) {
      send(c, { t: 'error', code, message: 'Could not verify your Batlas sign-in. Reload and try again.' });
      setTimeout(() => c.ws.close(4003, code), 20);
    }
  }

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    const c: Client = { cid: crypto.randomBytes(6).toString('base64url'), ws, user: null, room: null, state: null, crew: null, hidden: false, joinedAt: 0, bucket: { tokens: 120, last: Date.now() }, authed: null, equipped: new Set(), lastUse: new Map(), useCounts: new Map(), mutedUntil: 0, frozen: false, lastChat: 0, outfit: { ...DEFAULT_OUTFIT }, lastOutfit: 0, klass: null, term: newTerm(Date.now()) };
    clients.add(c);
    const authTimer = setTimeout(() => { if (!c.user) ws.close(4003, 'auth_timeout'); }, 10_000);
    ws.on('message', (data) => {
      const s = data.toString();
      void onMessage(c, s).catch((e) => log(`message error ${(e as Error).message}`));
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      leaveRoom(c, 'disconnected');
      clients.delete(c);
    });
    ws.on('error', () => {});
  });

  // Heartbeat: drop dead sockets so rooms don't keep ghosts.
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => { alive.set(ws, true); ws.on('pong', () => alive.set(ws, true)); });
  const hb = setInterval(() => {
    for (const c of clients) {
      if (alive.get(c.ws) === false) { c.ws.terminate(); continue; }
      alive.set(c.ws, false);
      try { c.ws.ping(); } catch {}
    }
  }, 15_000);
  hb.unref();
  // Weapon-use audit batches.
  const auditTimer = setInterval(() => { for (const c of clients) flushUses(c); }, 10_000);
  auditTimer.unref();

  /** When maintenance switches on, everyone except the Developer is removed with the maintenance screen. */
  async function enforceMaintenance() {
    const mm = await maintenanceMsg();
    if (!mm) return 0;
    let n = 0;
    for (const c of clients) {
      if (!c.user || isDev(c)) continue;
      eject(c, 'maintenance', { message: mm }, 4005);
      n++;
    }
    if (n) log(`maintenance: removed ${n} player(s)`);
    return n;
  }
  const maintTimer = setInterval(() => void enforceMaintenance(), opts.maintenancePollMs ?? 5000);
  maintTimer.unref();

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== WS_PATH) return;
    // Same-origin browsers only (plus non-browser clients that send no Origin, e.g. tests/servers).
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) { socket.destroy(); return; }
      } catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return {
    wss,
    rooms,
    clients,
    gameBans,
    enforceMaintenance,
    close: () => { clearInterval(hb); clearInterval(auditTimer); clearInterval(maintTimer); for (const c of clients) c.ws.terminate(); wss.close(); },
  };
}
