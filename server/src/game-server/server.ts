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
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { SiteBridge, VerifiedUser } from './bridge.js';
import { canActOn, ITEM_TIERS, type ItemTier, type Permission } from '../lib/permissions.js';

export const WS_PATH = '/ws/sky-crew';
export const MAX_PLAYERS = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const SPAWNABLE: Record<ItemTier, string[]> = {
  approved: ['suitcase', 'duffel', 'water', 'snack', 'blanket'],
  any: ['suitcase', 'duffel', 'water', 'snack', 'blanket', 'beach_ball', 'giant_duck', 'traffic_cone'],
  developer: ['wave_cannon'],
};
export const WEATHERS = ['clear', 'storm'] as const;
export const SCENARIOS = ['engine_failure', 'turbulence', 'cabin_pressure', 'emergency_landing'] as const;
export const TELEPORT_SPOTS = ['cockpit', 'cabin', 'cargo', 'apron'] as const;
export const NPC_ACTIONS = ['sit', 'dance', 'panic', 'calm', 'respawn'] as const;
export const CREW_ROLES = ['pilot', 'copilot', 'cabin', 'cargo'] as const;
const UNIQUE_CREW = new Set(['pilot', 'copilot']); // one captain and one first officer per room

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
}

interface Room {
  code: string;
  hostCid: string;
  pilotCid: string | null;
  clients: Map<string, Client>;
  weather: (typeof WEATHERS)[number];
  createdAt: number;
  locked: boolean; // host closed the room to new players
  route: string | null; // last values seen in the host's world snapshot (for the staff room list)
  phase: string | null;
}

type Send = (c: Client, msg: unknown) => void;

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const clampNum = (v: unknown, lim = 1e6) => (isNum(v) ? Math.max(-lim, Math.min(lim, v as number)) : 0);

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
  };
}

export interface GameServerOptions {
  bridge: SiteBridge;
  log?: (msg: string) => void;
}

export function attachGameServer(httpServer: HttpServer, opts: GameServerOptions) {
  const { bridge } = opts;
  const log = opts.log ?? ((m: string) => console.log(`[game] ${m}`));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();

  const send: Send = (c, msg) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const publicPlayer = (c: Client) => ({ cid: c.cid, username: c.user!.username, displayName: c.user!.displayName, role: c.user!.role, avatarUrl: c.user!.avatarUrl, crew: c.crew, state: c.state });
  // Hidden Developers are left out of everyone else's player list.
  const roomInfo = (r: Room, viewer?: Client) => ({ t: 'room', code: r.code, hostCid: r.hostCid, pilotCid: r.pilotCid, weather: r.weather, locked: r.locked, players: [...r.clients.values()].filter((p) => !p.hidden || p === viewer).map(publicPlayer) });
  const broadcastRoom = (r: Room, except?: Client) => { for (const c of r.clients.values()) if (c !== except) send(c, roomInfo(r, c)); };
  /** Developer rank, as verified by the website for this connection's game token (never client claims). */
  const isDev = (c: Client) => !!c.user && c.user.role === 'DEVELOPER';
  const broadcast = (r: Room, msg: unknown, except?: Client) => {
    const data = JSON.stringify(msg);
    for (const c of r.clients.values()) if (c !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };
  const can = (c: Client, p: Permission) => !!c.user && c.user.permissions.includes(p);

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
    r.clients.delete(c.cid);
    const wasHidden = c.hidden;
    c.room = null;
    c.state = null;
    c.crew = null;
    c.hidden = false;
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
    if (!opts.created && visible >= MAX_PLAYERS) { if (!dev) return send(c, { t: 'error', code: 'room_full', message: 'That room is full.' }); bypass.push('full'); }
    if (!opts.created && r.locked) { if (!dev) return send(c, { t: 'error', code: 'room_locked', message: 'That room is locked by its host.' }); bypass.push('locked'); }
    if (c.room) leaveRoom(c);
    c.hidden = dev && !!opts.hidden && !opts.created;
    c.joinedAt = Date.now();
    r.clients.set(c.cid, c);
    c.room = r;
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
        code: r.code, host: host?.user?.username ?? null, locked: r.locked, route: r.route, phase: r.phase, weather: r.weather, createdAt: new Date(r.createdAt).toISOString(),
        count: ps.filter((p) => !p.hidden).length, max: MAX_PLAYERS,
        players: ps.map((p) => ({ username: p.user!.username, role: p.user!.role, crew: p.crew, hidden: p.hidden, host: p.cid === r.hostCid })),
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

  /** Validates and applies an admin command. Returns an error string or null on success. */
  async function adminCommand(c: Client, cmd: string, args: any): Promise<string | null> {
    const r = c.room;
    if (!r) return 'Join a room first.';
    args = args && typeof args === 'object' ? args : {};
    const fx = (extra: Record<string, unknown> = {}) => broadcast(r, { t: 'fx', cmd, args: { ...args, ...extra }, by: { cid: c.cid, username: c.user!.username, role: c.user!.role } });
    const target = typeof args.cid === 'string' ? r.clients.get(args.cid) : undefined;

    switch (cmd) {
      case 'spawn': {
        const tier = (['approved', 'any', 'developer'] as const).includes(args.tier) ? (args.tier as ItemTier) : 'approved';
        if (!can(c, ITEM_TIERS[tier])) return 'Your rank cannot spawn that.';
        if (!SPAWNABLE[tier].includes(args.item)) return 'Unknown item for that tier.';
        const count = Math.max(1, Math.min(5, Math.floor(Number(args.count) || 1)));
        fx({ tier, item: args.item, count });
        await audit(c, 'spawn', { tier, item: args.item, count });
        return null;
      }
      case 'kick': {
        if (!can(c, 'players.kick')) return 'Your rank cannot kick players.';
        if (!target) return 'Player not found in this room.';
        if (isDev(target)) { await audit(c, 'kick.denied', { reason: 'developer' }, target); return 'The Developer is protected and cannot be kicked.'; }
        const g = canActOn({ id: c.user!.userId, role: c.user!.role }, { id: target.user!.userId, role: target.user!.role });
        if (!g.ok) {
          await audit(c, 'kick.denied', { reason: g.reason }, target);
          return g.reason;
        }
        await audit(c, 'kick', { reason: String(args.reason ?? '').slice(0, 200) }, target);
        send(target, { t: 'kicked', by: c.user!.username, reason: String(args.reason ?? '').slice(0, 200) });
        leaveRoom(target, 'kicked');
        setTimeout(() => target.ws.close(4001, 'kicked'), 50);
        return null;
      }
      case 'weather': {
        if (!can(c, 'weather.change')) return 'Your rank cannot change the weather.';
        if (!WEATHERS.includes(args.weather)) return 'Unknown weather.';
        r.weather = args.weather;
        fx();
        await audit(c, 'weather', { weather: args.weather });
        return null;
      }
      case 'emergency': {
        if (!can(c, 'emergency.trigger')) return 'Your rank cannot trigger emergencies.';
        if (!SCENARIOS.includes(args.scenario)) return 'Unknown scenario.';
        const action = args.action === 'stop' ? 'stop' : 'start';
        if (action === 'stop' && !can(c, 'emergency.manage')) return 'Your rank cannot stop emergencies.';
        fx({ action });
        await audit(c, `emergency.${action}`, { scenario: args.scenario });
        return null;
      }
      case 'teleport': {
        if (!can(c, 'teleport')) return 'Only the Developer can teleport.';
        if (!TELEPORT_SPOTS.includes(args.to)) return 'Unknown destination.';
        const who = target ?? c;
        if (who !== c) {
          const g = canActOn({ id: c.user!.userId, role: c.user!.role }, { id: who.user!.userId, role: who.user!.role });
          if (!g.ok) return g.reason;
        }
        fx({ cid: who.cid });
        await audit(c, 'teleport', { to: args.to }, who === c ? undefined : who);
        return null;
      }
      case 'npc': {
        if (!can(c, 'npc.control')) return 'Only the Developer can control NPCs.';
        if (!NPC_ACTIONS.includes(args.action)) return 'Unknown NPC action.';
        fx();
        await audit(c, 'npc', { action: args.action });
        return null;
      }
      case 'gear': {
        if (!can(c, 'items.spawn.developer')) return 'Developer-only equipment.';
        if (args.item !== 'wave_cannon') return 'Unknown gear.';
        fx({ cid: c.cid });
        await audit(c, 'gear', { item: args.item });
        return null;
      }
      case 'fire': {
        // Firing the fictional Wave Cannon. Gear grant is audited; individual shots are not (spam).
        if (!can(c, 'items.spawn.developer')) return 'Developer-only equipment.';
        const o = Array.isArray(args.o) ? args.o.slice(0, 3).map((n: unknown) => clampNum(n, 1e5)) : null;
        const d = Array.isArray(args.d) ? args.d.slice(0, 3).map((n: unknown) => clampNum(n, 2)) : null;
        if (!o || !d) return 'Bad shot.';
        broadcast(r, { t: 'fx', cmd: 'fire', args: { o, d }, by: { cid: c.cid, username: c.user!.username, role: c.user!.role } });
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
        let u: VerifiedUser | null = null;
        try {
          u = await bridge.verify(m.token);
        } catch (e) {
          log(`verify error ${(e as Error).message}`);
        }
        if (!u) return fail('auth_failed');
        c.user = u; // the ONLY source of name/rank/permissions
        send(c, { t: 'welcome', you: { cid: c.cid, username: u.username, displayName: u.displayName, role: u.role, permissions: u.permissions, avatarUrl: u.avatarUrl } });
      })();
      return;
    }
    if (!c.user) return send(c, { t: 'error', code: 'auth_required', message: 'Sign in first.' });

    const r = c.room;
    switch (m.t) {
      case 'ping':
        return send(c, { t: 'pong', at: m.at });
      case 'create': {
        const room: Room = { code: newCode(), hostCid: c.cid, pilotCid: null, clients: new Map(), weather: 'clear', createdAt: Date.now(), locked: false, route: null, phase: null };
        rooms.set(room.code, room);
        log(`room ${room.code} created by ${c.user.username}`);
        return joinRoom(c, room, { created: true });
      }
      case 'join': {
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
        c.state = s;
        if (c.hidden) return; // invisible spectator: nobody sees them move
        return broadcast(r, { t: 'st', cid: c.cid, s }, c);
      }
      case 'world':
        if (!r || r.hostCid !== c.cid) return; // only the host's simulation counts
        if (raw.length > 48 * 1024) return;
        if (m.w && typeof m.w === 'object') { r.route = typeof m.w.route === 'string' ? m.w.route.slice(0, 8) : r.route; r.phase = typeof m.w.ph === 'string' ? m.w.ph.slice(0, 16) : r.phase; }
        return broadcast(r, { t: 'world', w: m.w }, c);
      case 'pilot': {
        if (!r || c.hidden) return;
        if (m.on) {
          if (r.pilotCid && r.pilotCid !== c.cid) return send(c, { t: 'error', code: 'seat_taken', message: 'Someone else is flying.' });
          r.pilotCid = c.cid;
        } else if (r.pilotCid === c.cid) r.pilotCid = null;
        return broadcastRoom(r);
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
        const host = r.clients.get(r.hostCid);
        if (host && host !== c) send(host, { t: 'act', cid: c.cid, a: m.a });
        return;
      }
      case 'event':
        // host-originated gameplay events (results, chat-like notices) relayed to everyone
        if (!r || r.hostCid !== c.cid) return;
        return broadcast(r, { t: 'event', e: m.e }, c);
      case 'admin': {
        const err = await adminCommand(c, String(m.cmd ?? ''), m.args);
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
    const c: Client = { cid: crypto.randomBytes(6).toString('base64url'), ws, user: null, room: null, state: null, crew: null, hidden: false, joinedAt: 0, bucket: { tokens: 120, last: Date.now() }, authed: null };
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
    close: () => { clearInterval(hb); for (const c of clients) c.ws.terminate(); wss.close(); },
  };
}
