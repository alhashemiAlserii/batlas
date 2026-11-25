import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import request from 'supertest';
import { insertId } from '../src/db/index.js';
import { testDb, PW } from './helpers.js';
import { createApp } from '../src/app.js';
import { attachHighcragServer, HC_WS_PATH, HC_MAX_PLAYERS } from '../src/highcrag/server.js';
import { attachGameServer, WS_PATH } from '../src/game-server/server.js';
import { httpSiteBridge } from '../src/game-server/bridge.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryMailer } from '../src/lib/mailer.js';

const KEY = 'test-game-key-highcrag-123';
let server: http.Server, port: number, db: any, app: any;
let hc: ReturnType<typeof attachHighcragServer>, sky: ReturnType<typeof attachGameServer>;
let n = 0;

beforeAll(async () => {
  db = await testDb();
  app = createApp(db, { cookieSecure: false, gameServerKey: KEY, rateLimit: { windowMs: 60000, max: 1000 } }, { mailer: new MemoryMailer() }).app;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as any).port;
  const bridge = httpSiteBridge(`http://127.0.0.1:${port}`, KEY);
  // Both game servers share one HTTP server, exactly like production.
  sky = attachGameServer(server, { bridge, log: () => {} });
  hc = attachHighcragServer(server, { bridge, log: () => {}, proxy: { trustProxy: true, publicBaseUrl: 'https://batlas-szpab.pages.dev' } });
});
afterAll(async () => { hc.close(); sky.close(); await new Promise((r) => server.close(r)); await db.destroy(); });

async function token(name?: string) {
  const username = name ?? `climber_${++n}`;
  await insertId(db('users').insert({ username, username_lower: username.toLowerCase(), handle: username, handle_lower: username.toLowerCase(), password_hash: await hashPassword(PW), pin_set: true, role: 'PLAYER', display_name: `Disp ${username}`, created_at: new Date().toISOString() }));
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/csrf')).body.csrfToken;
  const login = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: username, password: PW });
  const c2 = (([] as string[]).concat(login.headers['set-cookie'] as any).find((s) => s.startsWith('csrf=')) ?? '').split(';')[0].slice(5) || csrf;
  const t = await agent.post('/api/game/token').set('x-csrf-token', decodeURIComponent(c2)).send({ game: 'highcrag' });
  expect(t.status).toBe(200);
  return { username, token: t.body.token as string };
}

class TC {
  ws: WebSocket; msgs: any[] = []; waiters: { f: (m: any) => boolean; r: (m: any) => void }[] = []; closed: { code: number; reason: string } | null = null;
  constructor(path = HC_WS_PATH, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    this.ws.on('message', (d) => { const m = JSON.parse(d.toString()); this.msgs.push(m); this.waiters = this.waiters.filter((w) => (w.f(m) ? (w.r(m), false) : true)); });
    this.ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
    this.ws.on('error', () => {});
  }
  open() { return new Promise<void>((r, j) => { if (this.ws.readyState === 1) return r(); this.ws.once('open', () => r()); this.ws.once('error', j); }); }
  send(m: any) { this.ws.send(JSON.stringify(m)); }
  wait(f: (m: any) => boolean, ms = 3000) {
    const hit = this.msgs.find(f); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise<any>((r, j) => { const t = setTimeout(() => j(new Error('timeout waiting')), ms); this.waiters.push({ f, r: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); r(m); } }); });
  }
  waitClose(ms = 3000) { return new Promise<{ code: number; reason: string }>((r, j) => { if (this.closed) return r(this.closed); const t = setTimeout(() => j(new Error('no close')), ms); this.ws.once('close', (code, reason) => { clearTimeout(t); r({ code, reason: reason.toString() }); }); }); }
  close() { this.ws.close(); }
}

async function signedIn(name?: string) {
  const { token: tk, username } = await token(name);
  const c = new TC();
  await c.open();
  c.send({ t: 'auth', token: tk });
  const w = await c.wait((m) => m.t === 'welcome');
  return { c, you: w.you, username };
}

describe('Highcrag co-op server', () => {
  it('requires a valid website sign-in; names come from the account', async () => {
    const bad = new TC();
    await bad.open();
    bad.send({ t: 'auth', token: 'x'.repeat(40) });
    expect((await bad.waitClose()).code).toBe(4001);

    const early = new TC();
    await early.open();
    early.send({ t: 'create' });
    expect((await early.waitClose()).code).toBe(4001);

    const { c, you, username } = await signedIn();
    expect(you.name).toBe(`Disp ${username}`);
    c.close();
  });

  it('refuses cross-origin browsers', async () => {
    const c = new TC(HC_WS_PATH, { origin: 'https://evil.example' });
    await expect(c.open()).rejects.toBeTruthy();
  });

  it('accepts the Pages front door', async () => {
    const c = new TC(HC_WS_PATH, { origin: 'https://batlas-szpab.pages.dev', 'x-forwarded-host': 'batlas-szpab.pages.dev' });
    await c.open();
    c.close();
  });

  it('runs alongside the Sky Crew server without touching it', async () => {
    const { token: tk } = await token();
    const s = new TC(WS_PATH);
    await s.open();
    s.send({ t: 'auth', token: tk });
    expect((await s.wait((m) => m.t === 'welcome')).t).toBe('welcome');
    s.close();
    expect(hc.rooms.size).toBe(0);
  });

  it('creates and joins rooms, shares the seed and layout, caps at 4', async () => {
    const a = await signedIn();
    const room = await (a.c.send({ t: 'create', seed: 4242, diff: 3 }), a.c.wait((m) => m.t === 'room'));
    expect(room.code).toMatch(/^[A-Z]{5}$/);
    expect(room.seed).toBe(4242);
    expect(room.diff).toBe(3);
    expect(room.layout).toBeNull();
    a.c.send({ t: 'layout', items: [['berry', 1, 2, 3], ['piton', 4, 5, 6], ['bogus', 0, 0, 0], ['ration', 1e9, 0, 0]], camps: [[10, 36, 10], [20, 126, 20]] });
    const lay = await a.c.wait((m) => m.t === 'layout');
    expect(lay.items).toEqual([['i0', 'berry', 1, 2, 3, 0], ['i1', 'piton', 4, 5, 6, 0]]);
    // A second layout upload is ignored.
    a.c.send({ t: 'layout', items: [['tonic', 0, 0, 0]], camps: [] });

    const b = await signedIn();
    b.c.send({ t: 'join', code: room.code.toLowerCase() });
    const rb = await b.c.wait((m) => m.t === 'room');
    expect(rb.seed).toBe(4242);
    expect(rb.layout.items).toHaveLength(2);
    expect(rb.players.map((p: any) => p.slot).sort()).toEqual([0, 1]);
    const joined = await a.c.wait((m) => m.t === 'joined');
    expect(joined.player.name).toBe(b.you.name);

    // Movement is relayed to the others only, and late joiners get the last known positions.
    a.c.send({ t: 'st', p: [1.234, 50, -3], f: 1.5, m: 'climb', a: 0, alt: 50 });
    const st = await b.c.wait((m) => m.t === 'st');
    expect(st).toMatchObject({ cid: a.you.cid, p: [1.23, 50, -3], m: 'climb' });
    a.c.send({ t: 'st', p: ['x', 0, 0], f: 0, m: 'climb' }); // invalid: dropped

    const c3 = await signedIn();
    const d4 = await signedIn();
    const e5 = await signedIn();
    c3.c.send({ t: 'join', code: room.code });
    expect((await c3.c.wait((m) => m.t === 'room')).states[a.you.cid].m).toBe('climb');
    d4.c.send({ t: 'join', code: room.code });
    await d4.c.wait((m) => m.t === 'room');
    e5.c.send({ t: 'join', code: room.code });
    const full = await e5.c.wait((m) => m.t === 'error');
    expect(full.code).toBe('room_full');
    expect(HC_MAX_PLAYERS).toBe(4);

    e5.c.send({ t: 'join', code: 'ZZZZZ' });
    expect((await e5.c.wait((m) => m.t === 'error')).code).toBe('no_room');

    // Leaving tells the others; the room closes when empty.
    d4.c.close();
    expect((await a.c.wait((m) => m.t === 'left')).cid).toBe(d4.you.cid);
    for (const x of [a, b, c3, e5]) x.c.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(hc.rooms.has(room.code)).toBe(false);
  });

  it('first claim wins an item; drops, campfires, pitons and the beacon are shared once', async () => {
    const a = await signedIn();
    const b = await signedIn();
    a.c.send({ t: 'create', diff: 9 });
    const room = await a.c.wait((m) => m.t === 'room');
    expect(room.diff).toBe(1); // unknown difficulty: the normal one
    a.c.send({ t: 'layout', items: [['berry', 1, 2, 3]], camps: [[0, 40, 0]] });
    await a.c.wait((m) => m.t === 'layout');
    b.c.send({ t: 'join', code: room.code });
    await b.c.wait((m) => m.t === 'room');

    a.c.send({ t: 'take', id: 'i0' });
    b.c.send({ t: 'take', id: 'i0' });
    const ta = await a.c.wait((m) => m.t === 'taken');
    const tb = await b.c.wait((m) => m.t === 'taken');
    expect(ta.by).toBe(a.you.cid);
    expect(tb.by).toBe(a.you.cid);
    expect((await b.c.wait((m) => m.t === 'take_no')).id).toBe('i0');

    b.c.send({ t: 'drop', type: 'warmer', p: [5, 6, 7] });
    const dr = await a.c.wait((m) => m.t === 'dropped');
    expect(dr).toMatchObject({ type: 'warmer', by: b.you.cid });
    b.c.send({ t: 'drop', type: 'rocket', p: [5, 6, 7] }); // unknown item: ignored

    b.c.send({ t: 'camp', i: 0 });
    b.c.send({ t: 'camp', i: 0 });
    expect((await a.c.wait((m) => m.t === 'camp')).by).toBe(b.you.cid);

    a.c.send({ t: 'piton', p: [1, 100, 1] });
    expect((await b.c.wait((m) => m.t === 'piton')).p).toEqual([1, 100, 1]);

    // Help between players is relayed to the target only.
    a.c.send({ t: 'down' });
    expect((await b.c.wait((m) => m.t === 'down')).cid).toBe(a.you.cid);
    b.c.send({ t: 'revive', to: a.you.cid });
    expect((await a.c.wait((m) => m.t === 'revive')).from).toBe(b.you.cid);
    a.c.send({ t: 'pull', to: b.you.cid, p: [3, 60, 3] });
    expect((await b.c.wait((m) => m.t === 'pull')).p).toEqual([3, 60, 3]);

    b.c.send({ t: 'beacon' });
    const bea = await a.c.wait((m) => m.t === 'beacon');
    expect(bea.name).toBe(b.you.name);

    // A late joiner sees everything that already happened.
    const c = await signedIn();
    c.c.send({ t: 'join', code: room.code });
    const rc = await c.c.wait((m) => m.t === 'room');
    expect(rc.layout.items.find((i: any) => i[0] === 'i0')[5]).toBe(1);
    expect(rc.layout.items.some((i: any) => i[1] === 'warmer')).toBe(true);
    expect(rc.lit).toEqual([0]);
    expect(rc.pitons).toEqual([[1, 100, 1]]);
    expect(rc.beacon.by).toBe(b.you.name);
    for (const x of [a, b, c]) x.c.close();
  });

  it('boards the whole room once, and shares looks, emotes, ropes and flares', async () => {
    const a = await signedIn();
    const b = await signedIn();
    a.c.send({ t: 'create' });
    const room = await a.c.wait((m) => m.t === 'room');
    expect(room.boarded).toBe(false);
    b.c.send({ t: 'join', code: room.code });
    await b.c.wait((m) => m.t === 'room');

    a.c.send({ t: 'look', look: { s: 7, f: 2, hr: 6, hc: 8, h: 14, t: 3, c: 3, b: 4, bc: 5, sh: 2, a: 8 } });
    expect((await b.c.wait((m) => m.t === 'look')).look).toEqual({ s: 7, f: 2, hr: 6, hc: 8, h: 14, t: 3, c: 3, b: 4, bc: 5, sh: 2, a: 8 });
    a.c.send({ t: 'look', look: { c: 99, h: -1, s: 'x', hr: 8, evil: '<script>' } });
    expect((await b.c.wait((m) => m.t === 'look')).look).toEqual({ s: 0, f: 0, hr: 0, hc: 0, h: 0, t: 0, c: 0, b: 0, bc: 0, sh: 0, a: 0 });

    b.c.send({ t: 'emote', e: 'wave' });
    expect((await a.c.wait((m) => m.t === 'emote')).e).toBe('wave');
    b.c.send({ t: 'emote', e: 'rude' }); // unknown: ignored

    b.c.send({ t: 'board' });
    b.c.send({ t: 'board' });
    expect((await a.c.wait((m) => m.t === 'board')).by).toBe(b.you.cid);
    expect((await b.c.wait((m) => m.t === 'board')).by).toBe(b.you.cid);

    a.c.send({ t: 'rope', top: [1, 50, 1], bottom: [1, 30, 1], a: [0.5, 49.7, 0.5] });
    expect((await b.c.wait((m) => m.t === 'rope')).bottom).toEqual([1, 30, 1]);
    a.c.send({ t: 'rope', top: [1, 10, 1], bottom: [1, 30, 1], a: [0, 0, 0] }); // upside down: ignored
    a.c.send({ t: 'flare', p: [2, 60, 2] });
    expect((await b.c.wait((m) => m.t === 'flare')).p).toEqual([2, 60, 2]);
    a.c.send({ t: 'st', p: [1, 40, 1], f: 0, m: 'rope', alt: 40 });
    expect((await b.c.wait((m) => m.t === 'st')).m).toBe('rope');

    const c = await signedIn();
    c.c.send({ t: 'join', code: room.code });
    const rc = await c.c.wait((m) => m.t === 'room');
    expect(rc.boarded).toBe(true);
    expect(rc.ropes).toHaveLength(1);
    expect(rc.flares).toEqual([[2, 60, 2]]);
    expect(rc.players.find((p: any) => p.cid === a.you.cid).look).toEqual({ s: 0, f: 0, hr: 0, hc: 0, h: 0, t: 0, c: 0, b: 0, bc: 0, sh: 0, a: 0 });
    for (const x of [a, b, c]) x.c.close();
  });

  it('shares pings, the horn and bean vines; relays gifts and carrying to one teammate', async () => {
    const a = await signedIn();
    const b = await signedIn();
    const c = await signedIn();
    a.c.send({ t: 'create' });
    const room = await a.c.wait((m) => m.t === 'room');
    for (const x of [b, c]) { x.c.send({ t: 'join', code: room.code }); await x.c.wait((m) => m.t === 'room'); }

    a.c.send({ t: 'ping', p: [1, 2, 3], k: 'horn' });
    expect(await b.c.wait((m) => m.t === 'ping')).toMatchObject({ p: [1, 2, 3], k: 'horn', by: a.you.cid });
    expect((await c.c.wait((m) => m.t === 'ping')).k).toBe('horn');
    a.c.send({ t: 'ping', p: [1, 2, 3], k: 'nuke' }); // unknown kind: ignored
    a.c.send({ t: 'say', i: 2 });
    expect(await b.c.wait((m) => m.t === 'say')).toMatchObject({ cid: a.you.cid, i: 2 });
    a.c.send({ t: 'say', i: 9 }); // not one of the set phrases: ignored
    a.c.send({ t: 'say', i: 'hello' }); // free text: ignored

    a.c.send({ t: 'vine', p: [10, 40, 10], d: [0.6, -0.8] });
    expect(await b.c.wait((m) => m.t === 'vine')).toMatchObject({ p: [10, 40, 10], d: [0.6, -0.8] });
    a.c.send({ t: 'vine', p: [10, 40, 10], d: [9, 9] }); // bad direction: ignored

    a.c.send({ t: 'zip', a: [0, 50, 0], b: [20, 40, 5] });
    expect(await b.c.wait((m) => m.t === 'zip')).toMatchObject({ a: [0, 50, 0], b: [20, 40, 5] });
    a.c.send({ t: 'zip', a: [0, 50, 0], b: [10, 60, 0] }); // uphill: ignored
    a.c.send({ t: 'zip', a: [0, 50, 0], b: [90, 50, 0] }); // too long: ignored
    a.c.send({ t: 'shelf', p: [3, 30, 4], n: [0.6, 0.8] });
    expect(await b.c.wait((m) => m.t === 'shelf')).toMatchObject({ p: [3, 30, 4], n: [0.6, 0.8] });
    a.c.send({ t: 'shelf', p: [3, 30, 4], n: [7, 7] }); // bad direction: ignored

    a.c.send({ t: 'give', to: b.you.cid, type: 'lantern' });
    expect(await b.c.wait((m) => m.t === 'give')).toMatchObject({ from: a.you.cid, type: 'lantern' });
    a.c.send({ t: 'give', to: b.you.cid, type: 'gold' }); // unknown item: ignored
    a.c.send({ t: 'give', to: b.you.cid, type: 'honey@1' }); // honeycomb can't be roasted: ignored
    a.c.send({ t: 'give', to: b.you.cid, type: 'berry@4' }); // no such roast level: ignored
    a.c.send({ t: 'give', to: b.you.cid, type: 'berry@1' }); // roasted food is fine
    expect(await b.c.wait((m) => m.t === 'give' && m.type !== 'lantern')).toMatchObject({ from: a.you.cid, type: 'berry@1' });

    b.c.send({ t: 'carry', to: c.you.cid });
    expect((await c.c.wait((m) => m.t === 'carry')).from).toBe(b.you.cid);
    b.c.send({ t: 'uncarry', to: c.you.cid });
    expect((await c.c.wait((m) => m.t === 'uncarry')).from).toBe(b.you.cid);

    // Gifts and carrying go to the target only; vines are kept for late joiners.
    await new Promise((r) => setTimeout(r, 200));
    expect(c.c.msgs.some((m) => m.t === 'give')).toBe(false);
    expect(a.c.msgs.some((m) => m.t === 'carry')).toBe(false);
    expect(b.c.msgs.some((m) => m.k === 'nuke' || (m.t === 'give' && m.type === 'gold'))).toBe(false);
    const d = await signedIn();
    d.c.send({ t: 'join', code: room.code });
    const snap = await d.c.wait((m) => m.t === 'room');
    expect(snap.vines).toEqual([[10, 40, 10, 0.6, -0.8]]);
    expect(snap.zips).toEqual([[0, 50, 0, 20, 40, 5]]);
    for (const x of [a, b, c, d]) x.c.close();
  });

  it('closes clients that flood messages', async () => {
    const a = await signedIn();
    for (let i = 0; i < 200; i++) a.c.send({ t: 'st', p: [0, 0, 0], f: 0, m: 'ground' });
    expect((await a.c.waitClose()).code).toBe(4008);
  });
});
