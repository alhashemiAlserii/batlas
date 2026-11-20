/**
 * Highcrag co-op server: rooms of up to 4 climbers on the same seeded mountain.
 *
 * Fully separate from the Sky Crew game server (own WebSocket path, own rooms); it only reuses the
 * site's token check (SiteBridge.verify), so names come from real Batlas accounts, never the client.
 *
 * The server owns the shared world state of each room: which items were taken (first claim wins),
 * dropped items, lit campfires, placed pitons and the summit beacon. Player movement is relayed.
 * The room creator uploads the item/camp layout once so every client (any browser engine) agrees.
 */
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { SiteBridge } from '../game-server/bridge.js';

export const HC_WS_PATH = '/ws/highcrag';
export const HC_MAX_PLAYERS = 4;
const ITEM_TYPES = new Set(['berry', 'mushroom', 'ration', 'bandage', 'warmer', 'piton', 'tonic', 'compass', 'rope', 'flare', 'medkit', 'binoculars', 'horn', 'lantern', 'chalk', 'bean', 'marshmallow']);
const EMOTES = new Set(['wave', 'cheer', 'point']);
const MAX_ITEMS = 400;
const MAX_PITONS = 300;
const MAX_ROPES = 120;
const MAX_FLARES = 60;
const MAX_VINES = 80;
const PING_KINDS = new Set(['ping', 'horn']);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

interface Client {
  cid: number;
  ws: WebSocket;
  user: { userId: number; username: string; displayName: string; role: string } | null;
  room: Room | null;
  slot: number;
  look: Record<string, number>;
  lastState: unknown;
  msgCount: number;
  alive: boolean;
}
interface Item { id: string; type: string; p: [number, number, number]; taken: boolean }
interface Room {
  code: string;
  seed: number;
  clients: Map<number, Client>;
  items: Map<string, Item> | null;
  camps: [number, number, number][] | null;
  lit: Set<number>;
  pitons: [number, number, number][];
  ropes: [number, number, number][][];
  flares: [number, number, number][];
  vines: number[][];
  boarded: boolean;
  beacon: { by: string } | null;
  dropSeq: number;
  createdAt: number;
}

const num = (v: unknown, lim = 1e5) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const vec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => num(x, 2000));
const round = (v: number) => Math.round(v * 100) / 100;
const smallInt = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : 0);
// Outfit pieces and how many options each has (must match the game's wardrobe).
const LOOK_LIMITS: Record<string, number> = { s: 11, f: 3, h: 15, t: 7, c: 9, b: 4, bc: 9, sh: 3, a: 8 };
const validLook = (l: any) => Object.fromEntries(Object.entries(LOOK_LIMITS).map(([k, max]) => [k, smallInt(l?.[k], max)]));

export function attachHighcragServer(
  httpServer: http.Server,
  opts: { bridge: SiteBridge; log?: (m: string) => void; maxRooms?: number },
) {
  const log = opts.log ?? ((m: string) => console.log(`[highcrag] ${m}`));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  let nextCid = 1;

  const send = (c: Client, m: unknown) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };
  const broadcast = (room: Room, m: unknown, except?: Client) => { for (const c of room.clients.values()) if (c !== except) send(c, m); };
  const playerOut = (c: Client) => ({ cid: c.cid, name: c.user!.displayName || c.user!.username, username: c.user!.username, role: c.user!.role, slot: c.slot, look: c.look });

  function roomOut(room: Room, you: Client) {
    return {
      t: 'room',
      code: room.code,
      seed: room.seed,
      you: you.cid,
      players: [...room.clients.values()].map(playerOut),
      layout: room.items ? { items: [...room.items.values()].map((i) => [i.id, i.type, ...i.p, i.taken ? 1 : 0]), camps: room.camps } : null,
      lit: [...room.lit],
      pitons: room.pitons,
      ropes: room.ropes,
      flares: room.flares,
      vines: room.vines,
      boarded: room.boarded,
      beacon: room.beacon,
      states: Object.fromEntries([...room.clients.values()].filter((c) => c !== you && c.lastState).map((c) => [c.cid, c.lastState])),
    };
  }

  function newCode() {
    for (let k = 0; k < 50; k++) {
      let s = '';
      for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(s)) return s;
    }
    throw new Error('no free room code');
  }

  function leave(c: Client) {
    const room = c.room;
    if (!room) return;
    room.clients.delete(c.cid);
    c.room = null;
    if (room.clients.size === 0) { rooms.delete(room.code); log(`room ${room.code} closed`); }
    else broadcast(room, { t: 'left', cid: c.cid });
  }

  function onMessage(c: Client, m: any) {
    if (!c.user) {
      if (m.t !== 'auth' || typeof m.token !== 'string' || m.token.length > 200) return c.ws.close(4001, 'Sign in first.');
      void opts.bridge.verify(m.token).then((u) => {
        if (c.ws.readyState !== WebSocket.OPEN) return;
        if (!u) return c.ws.close(4001, 'Your sign-in expired. Reload the page and try again.');
        if ('maintenance' in u) { send(c, { t: 'maintenance', message: u.message ?? 'Batlas is under maintenance.' }); return c.ws.close(4003, 'maintenance'); }
        c.user = { userId: u.userId, username: u.username, displayName: u.displayName, role: u.role };
        send(c, { t: 'welcome', you: { cid: c.cid, name: u.displayName || u.username, username: u.username, role: u.role } });
      }).catch(() => c.ws.close(1011, 'Could not check your sign-in.'));
      return;
    }
    const room = c.room;
    switch (m.t) {
      case 'create': {
        if (room) leave(c);
        if (rooms.size >= (opts.maxRooms ?? 500)) return send(c, { t: 'error', code: 'full', message: 'Too many rooms are open right now.' });
        const seed = num(m.seed, 4294967295) && m.seed > 0 ? Math.floor(m.seed) : Math.floor(Math.random() * 1e9) + 1;
        const r: Room = { code: newCode(), seed, clients: new Map(), items: null, camps: null, lit: new Set(), pitons: [], ropes: [], flares: [], vines: [], boarded: false, beacon: null, dropSeq: 0, createdAt: Date.now() };
        rooms.set(r.code, r);
        c.slot = 0;
        r.clients.set(c.cid, c);
        c.room = r;
        log(`room ${r.code} created by ${c.user.username} (seed ${seed})`);
        return send(c, roomOut(r, c));
      }
      case 'join': {
        const code = String(m.code ?? '').trim().toUpperCase();
        const r = rooms.get(code);
        if (!r) return send(c, { t: 'error', code: 'no_room', message: `No room called ${code || '…'}.` });
        if (r === room) return send(c, roomOut(r, c));
        if (r.clients.size >= HC_MAX_PLAYERS) return send(c, { t: 'error', code: 'room_full', message: `That room already has ${HC_MAX_PLAYERS} climbers.` });
        if (room) leave(c);
        const used = new Set([...r.clients.values()].map((x) => x.slot));
        c.slot = [0, 1, 2, 3].find((s) => !used.has(s)) ?? 0;
        r.clients.set(c.cid, c);
        c.room = r;
        c.lastState = null;
        broadcast(r, { t: 'joined', player: playerOut(c) }, c);
        return send(c, roomOut(r, c));
      }
      case 'leave':
        leave(c);
        return send(c, { t: 'room_left' });
    }
    if (!room) return;
    switch (m.t) {
      case 'layout': {
        // First upload wins; later ones are ignored so nobody can reshuffle the mountain mid-climb.
        if (room.items || !Array.isArray(m.items) || !Array.isArray(m.camps)) return;
        const items = new Map<string, Item>();
        for (const it of m.items.slice(0, MAX_ITEMS)) {
          if (!Array.isArray(it) || !ITEM_TYPES.has(it[0]) || !vec3(it.slice(1, 4))) continue;
          const id = `i${items.size}`;
          items.set(id, { id, type: it[0], p: [round(it[1]), round(it[2]), round(it[3])], taken: false });
        }
        room.items = items;
        room.camps = m.camps.filter(vec3).slice(0, 8).map((p: number[]) => p.map(round) as [number, number, number]);
        return broadcast(room, { t: 'layout', items: [...items.values()].map((i) => [i.id, i.type, ...i.p, 0]), camps: room.camps });
      }
      case 'st': {
        if (!vec3(m.p) || !num(m.f, 100) || !['ground', 'air', 'climb', 'rope', 'down'].includes(m.m)) return;
        const st = { p: m.p.map(round), f: round(m.f), m: m.m, a: num(m.a, 1e6) ? round(m.a) : 0, alt: num(m.alt, 2000) ? Math.round(m.alt) : 0, l: m.l === 1 ? 1 : 0 };
        c.lastState = st;
        return broadcast(room, { t: 'st', cid: c.cid, ...st }, c);
      }
      case 'take': {
        const it = room.items?.get(String(m.id));
        if (!it || it.taken) return send(c, { t: 'take_no', id: String(m.id) });
        it.taken = true;
        return broadcast(room, { t: 'taken', id: it.id, by: c.cid, type: it.type });
      }
      case 'drop': {
        if (!room.items || !ITEM_TYPES.has(m.type) || !vec3(m.p) || room.items.size >= MAX_ITEMS + 200) return;
        const id = `d${++room.dropSeq}`;
        const it: Item = { id, type: m.type, p: m.p.map(round) as [number, number, number], taken: false };
        room.items.set(id, it);
        return broadcast(room, { t: 'dropped', id, type: it.type, p: it.p, by: c.cid });
      }
      case 'camp': {
        const i = Number(m.i);
        if (!Number.isInteger(i) || i < 0 || i > 7 || room.lit.has(i)) return;
        room.lit.add(i);
        return broadcast(room, { t: 'camp', i, by: c.cid });
      }
      case 'piton': {
        if (!vec3(m.p) || room.pitons.length >= MAX_PITONS) return;
        const p = m.p.map(round) as [number, number, number];
        room.pitons.push(p);
        return broadcast(room, { t: 'piton', p, by: c.cid }, c);
      }
      case 'board': {
        // Anyone at the gate starts the flight for the whole room, once.
        if (room.boarded) return;
        room.boarded = true;
        return broadcast(room, { t: 'board', by: c.cid });
      }
      case 'look': {
        c.look = validLook(m.look);
        return broadcast(room, { t: 'look', cid: c.cid, look: c.look }, c);
      }
      case 'emote': {
        if (!EMOTES.has(m.e)) return;
        return broadcast(room, { t: 'emote', cid: c.cid, e: m.e }, c);
      }
      case 'rope': {
        if (!vec3(m.top) || !vec3(m.bottom) || !vec3(m.a) || room.ropes.length >= MAX_ROPES) return;
        if (m.top[1] < m.bottom[1] || m.top[1] - m.bottom[1] > 40) return;
        const r = [m.top.map(round), m.bottom.map(round), m.a.map(round)] as [number, number, number][];
        room.ropes.push(r);
        return broadcast(room, { t: 'rope', top: r[0], bottom: r[1], a: r[2], by: c.cid }, c);
      }
      case 'flare': {
        if (!vec3(m.p) || room.flares.length >= MAX_FLARES) return;
        const p = m.p.map(round) as [number, number, number];
        room.flares.push(p);
        return broadcast(room, { t: 'flare', p, by: c.cid }, c);
      }
      case 'vine': {
        // A magic-bean vine: base point and the horizontal direction into the wall.
        if (!vec3(m.p) || !Array.isArray(m.d) || m.d.length !== 2 || !m.d.every((v: unknown) => num(v, 2)) || room.vines.length >= MAX_VINES) return;
        const v = [...m.p.map(round), round(m.d[0]), round(m.d[1])];
        room.vines.push(v);
        return broadcast(room, { t: 'vine', p: v.slice(0, 3), d: v.slice(3), by: c.cid }, c);
      }
      case 'ping': {
        if (!vec3(m.p) || !PING_KINDS.has(m.k)) return;
        return broadcast(room, { t: 'ping', p: m.p.map(round), k: m.k, by: c.cid }, c);
      }
      case 'give': {
        // Hand an item to a teammate; the receiver adds it to their pack (or drops it if full).
        const target = room.clients.get(Number(m.to));
        if (!target || target === c || !ITEM_TYPES.has(m.type)) return;
        return send(target, { t: 'give', from: c.cid, type: m.type });
      }
      case 'beacon': {
        if (room.beacon) return;
        room.beacon = { by: c.user.displayName || c.user.username };
        return broadcast(room, { t: 'beacon', by: c.cid, name: room.beacon.by });
      }
      case 'pull':
      case 'carry':
      case 'uncarry':
      case 'revive': {
        // Player-to-player help: relayed to the target, who checks range/state on their side.
        const target = room.clients.get(Number(m.to));
        if (!target || target === c) return;
        return send(target, { t: m.t, from: c.cid, p: vec3(m.p) ? m.p.map(round) : null });
      }
      case 'down':
      case 'up':
        return broadcast(room, { t: m.t, cid: c.cid }, c);
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    const c: Client = { cid: nextCid++, ws, user: null, room: null, slot: 0, look: validLook({ s: 1, h: 1, t: 2, b: 1, bc: 1 }), lastState: null, msgCount: 0, alive: true };
    clients.add(c);
    const authTimer = setTimeout(() => { if (!c.user) ws.close(4001, 'Sign in first.'); }, 10000);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data) => {
      // Generous flood guard: ~20 state updates/s plus events is far below this.
      if (++c.msgCount > 120) { ws.close(4008, 'Too many messages.'); return; }
      let m: any;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      try { onMessage(c, m); } catch (e) { log(`message error: ${(e as Error).message}`); }
    });
    ws.on('close', () => { clearTimeout(authTimer); leave(c); clients.delete(c); });
  });

  const rateTimer = setInterval(() => { for (const c of clients) c.msgCount = 0; }, 1000);
  rateTimer.unref();
  const hb = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* closing */ }
    }
  }, 30000);
  hb.unref();

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== HC_WS_PATH) return;
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
    close: () => { clearInterval(rateTimer); clearInterval(hb); for (const c of clients) c.ws.terminate(); wss.close(); },
  };
}
