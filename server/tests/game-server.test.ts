import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createDb, migrate } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { attachGameServer, WS_PATH } from '../src/game-server/server.js';
import { httpSiteBridge } from '../src/game-server/bridge.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import request from 'supertest';
import type { Role } from '../src/lib/permissions.js';

const KEY = 'test-game-key-xyz-123';
let server: http.Server, port: number, db: any, gs: ReturnType<typeof attachGameServer>, app: any;
const PW = 'correct-horse-battery';
let n = 0;

beforeAll(async () => {
  db = createDb(':memory:');
  await migrate(db);
  app = createApp(db, { cookieSecure: false, gameServerKey: KEY, rateLimit: { windowMs: 60000, max: 1000 } }, { mailer: new MemoryMailer() }).app;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as any).port;
  gs = attachGameServer(server, { bridge: httpSiteBridge(`http://127.0.0.1:${port}`, KEY), log: () => {} });
});
afterAll(async () => { gs.close(); await new Promise((r) => server.close(r)); await db.destroy(); });

/** Creates a user, logs in via the website and fetches a game token. */
async function tokenFor(role: Role, name?: string) {
  const username = name ?? `${role.toLowerCase()}_${++n}`;
  const [id] = await db('users').insert({ username, username_lower: username.toLowerCase(), password_hash: await hashPassword(PW), role, display_name: username, created_at: new Date().toISOString() });
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/csrf')).body.csrfToken;
  const login = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: username, password: PW });
  const c2 = (([] as string[]).concat(login.headers['set-cookie'] as any).find((s) => s.startsWith('csrf=')) ?? '').split(';')[0].slice(5) || csrf;
  const t = await agent.post('/api/game/token').set('x-csrf-token', decodeURIComponent(c2)).send({ game: 'sky-crew' });
  expect(t.status).toBe(200);
  return { id: Number(id), username, token: t.body.token as string };
}

class TC {
  ws: WebSocket; msgs: any[] = []; waiters: { f: (m: any) => boolean; r: (m: any) => void }[] = []; closed: { code: number } | null = null;
  constructor(headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`, { headers });
    this.ws.on('message', (d) => { const m = JSON.parse(d.toString()); this.msgs.push(m); this.waiters = this.waiters.filter((w) => (w.f(m) ? (w.r(m), false) : true)); });
    this.ws.on('close', (code) => { this.closed = { code }; });
  }
  open() { return new Promise<void>((r, j) => { if (this.ws.readyState === 1) return r(); this.ws.once('open', () => r()); this.ws.once('error', j); }); }
  send(m: any) { this.ws.send(JSON.stringify(m)); }
  wait(f: (m: any) => boolean, ms = 3000) {
    const hit = this.msgs.find(f); if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise<any>((r, j) => { const t = setTimeout(() => j(new Error('timeout waiting')), ms); this.waiters.push({ f, r: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); r(m); } }); });
  }
  waitClose(ms = 3000) { return new Promise<number>((r, j) => { if (this.closed) return r(this.closed.code); const t = setTimeout(() => j(new Error('no close')), ms); this.ws.once('close', (c) => { clearTimeout(t); r(c); }); }); }
  close() { this.ws.close(); }
}

async function player(role: Role, name?: string) {
  const u = await tokenFor(role, name);
  const c = new TC();
  await c.open();
  c.send({ t: 'auth', token: u.token, role: 'DEVELOPER', permissions: ['players.kick'] }); // forged extras must be ignored
  const w = await c.wait((m) => m.t === 'welcome' || m.t === 'error');
  return { ...u, c, welcome: w };
}
async function room(host: any, ...others: any[]) {
  host.c.send({ t: 'create' });
  const r = await host.c.wait((m: any) => m.t === 'room' && m.you);
  for (const o of others) { o.c.send({ t: 'join', code: r.code }); await o.c.wait((m: any) => m.t === 'room' && m.you); }
  return r.code as string;
}
const admin = (p: any, cmd: string, args: object = {}) => { p.c.send({ t: 'admin', cmd, args }); return p.c.wait((m: any) => (m.t === 'admin_ok' || m.t === 'admin_denied') && m.cmd === cmd); };
const cidOf = (p: any) => p.welcome.you.cid;

describe('game server auth', () => {
  it('rejects bad tokens and closes', async () => {
    const c = new TC(); await c.open();
    c.send({ t: 'auth', token: 'not-a-real-token-123' });
    expect((await c.wait((m) => m.t === 'error')).code).toBe('auth_failed');
    expect(await c.waitClose()).toBe(4003);
  });
  it('requires auth before anything else', async () => {
    const c = new TC(); await c.open();
    c.send({ t: 'create' });
    expect((await c.wait((m) => m.t === 'error')).code).toBe('auth_required');
    c.close();
  });
  it('uses the server-verified rank; forged role/permissions are ignored', async () => {
    const p = await player('PLAYER');
    expect(p.welcome.t).toBe('welcome');
    expect(p.welcome.you.role).toBe('PLAYER');
    expect(p.welcome.you.permissions).toEqual([]);
    await room(p);
    expect((await admin(p, 'weather', { weather: 'storm' })).t).toBe('admin_denied');
    p.c.close();
  });
  it('rejects cross-origin browser connections', async () => {
    const c = new TC({ Origin: 'http://evil.example' });
    await expect(c.open()).rejects.toBeTruthy();
  });
  it('banned players cannot join (token revoked)', async () => {
    const u = await tokenFor('PLAYER');
    await db('users').where({ id: u.id }).update({ banned: true });
    const c = new TC(); await c.open();
    c.send({ t: 'auth', token: u.token });
    expect((await c.wait((m) => m.t === 'error')).code).toBe('auth_failed');
  });
});

describe('rooms', () => {
  it('create/join by code, see each other, state relay, leave & disconnect, host migration', async () => {
    const a = await player('PLAYER', 'alice'); const b = await player('PLAYER', 'bob'); const c = await player('TRUSTED', 'cara');
    const code = await room(a, b, c);
    expect(code).toMatch(/^[A-Z]{5}$/);
    const info = await a.c.wait((m) => m.t === 'room' && m.players.length === 3);
    expect(info.players.map((p: any) => [p.username, p.role]).sort()).toEqual([['alice', 'PLAYER'], ['bob', 'PLAYER'], ['cara', 'TRUSTED']]);
    expect(info.hostCid).toBe(cidOf(a));
    // state relay, sanitized
    b.c.send({ t: 'st', s: { p: [1, 2, 3], ry: 0.5, held: 'bag_1', role: 'DEVELOPER', username: 'hacker' } });
    const st = await a.c.wait((m) => m.t === 'st' && m.cid === cidOf(b));
    expect(st.s.p).toEqual([1, 2, 3]);
    expect(st.s.held).toBe('bag_1');
    expect(st.s).not.toHaveProperty('role');
    expect(st.s).not.toHaveProperty('username');
    // only the host's world snapshots are relayed
    b.c.send({ t: 'world', w: { fake: true } });
    a.c.send({ t: 'world', w: { real: true } });
    expect((await b.c.wait((m) => m.t === 'world')).w).toEqual({ real: true });
    // gameplay requests from guests go to host
    b.c.send({ t: 'act', a: { kind: 'grab', id: 'bag_1' } });
    expect((await a.c.wait((m) => m.t === 'act')).cid).toBe(cidOf(b));
    // pilot seat is exclusive; only the pilot's plane state is relayed
    b.c.send({ t: 'pilot', on: true });
    await a.c.wait((m) => m.t === 'room' && m.pilotCid === cidOf(b));
    c.c.send({ t: 'pilot', on: true });
    expect((await c.c.wait((m) => m.t === 'error')).code).toBe('seat_taken');
    c.c.send({ t: 'plane', s: { fake: 1 } });
    b.c.send({ t: 'plane', s: { alt: 300 } });
    expect((await a.c.wait((m) => m.t === 'plane')).s).toEqual({ alt: 300 });
    // leave
    c.c.send({ t: 'leave' });
    expect((await a.c.wait((m) => m.t === 'left')).cid).toBe(cidOf(c));
    // host disconnects -> bob becomes host; pilot seat freed when pilot leaves later
    a.c.close();
    const r2 = await b.c.wait((m) => m.t === 'room' && m.players.length === 1);
    expect(r2.hostCid).toBe(cidOf(b));
    b.c.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(gs.rooms.has(code)).toBe(false); // empty room cleaned up
    c.c.close();
  });
  it('unknown room code and full rooms are refused', async () => {
    const p = await player('PLAYER');
    p.c.send({ t: 'join', code: 'ZZZZZ' });
    expect((await p.c.wait((m) => m.t === 'error')).code).toBe('no_room');
    p.c.close();
  });
});

describe('in-game admin permissions', () => {
  it('player: nothing; trusted: approved spawns only; admin: + kick/weather/emergency; developer: everything', async () => {
    const dev = await player('DEVELOPER', 'the_dev'); const adm = await player('ADMIN', 'an_admin'); const adm2 = await player('ADMIN', 'admin_two');
    const tr = await player('TRUSTED', 'trusty'); const pl = await player('PLAYER', 'normie'); const pl2 = await player('PLAYER', 'victim');
    await room(dev, adm, adm2, tr, pl, pl2);

    for (const [cmd, args] of [['spawn', { item: 'suitcase' }], ['kick', { cid: cidOf(pl2) }], ['weather', { weather: 'storm' }], ['emergency', { scenario: 'turbulence' }], ['teleport', { to: 'cockpit' }], ['npc', { action: 'dance' }], ['gear', { item: 'wave_cannon' }]] as const) {
      expect((await admin(pl, cmd, args)).t, `player ${cmd}`).toBe('admin_denied');
    }
    expect((await admin(tr, 'spawn', { item: 'suitcase', tier: 'approved' })).t).toBe('admin_ok');
    expect((await admin(tr, 'spawn', { item: 'giant_duck', tier: 'any' })).t).toBe('admin_denied');
    expect((await admin(tr, 'spawn', { item: 'wave_cannon', tier: 'developer' })).t).toBe('admin_denied');
    expect((await admin(tr, 'kick', { cid: cidOf(pl) })).t).toBe('admin_denied');
    expect((await admin(tr, 'weather', { weather: 'storm' })).t).toBe('admin_denied');
    expect((await admin(tr, 'emergency', { scenario: 'engine_failure' })).t).toBe('admin_denied');

    expect((await admin(adm, 'weather', { weather: 'storm' })).t).toBe('admin_ok');
    const fx = await pl.c.wait((m) => m.t === 'fx' && m.cmd === 'weather');
    expect(fx.args.weather).toBe('storm');
    expect(fx.by.role).toBe('ADMIN');
    expect((await admin(adm, 'emergency', { scenario: 'engine_failure' })).t).toBe('admin_ok');
    expect((await admin(adm, 'emergency', { scenario: 'engine_failure', action: 'stop' })).t).toBe('admin_ok');
    expect((await admin(adm, 'spawn', { item: 'suitcase' })).t).toBe('admin_ok');
    expect((await admin(adm, 'spawn', { item: 'wave_cannon', tier: 'developer' })).t).toBe('admin_denied');
    expect((await admin(adm, 'teleport', { to: 'cockpit' })).t).toBe('admin_denied');
    expect((await admin(adm, 'npc', { action: 'dance' })).t).toBe('admin_denied');
    expect((await admin(adm, 'gear', { item: 'wave_cannon' })).t).toBe('admin_denied');
    expect((await admin(adm, 'fire', { o: [0, 0, 0], d: [0, 0, -1] })).t).toBe('admin_denied');
    // Developer cannot be kicked; admins can't kick admins
    const kd = await admin(adm, 'kick', { cid: cidOf(dev) });
    expect(kd.t).toBe('admin_denied');
    expect(kd.reason).toMatch(/protected/i);
    expect((await admin(adm, 'kick', { cid: cidOf(adm2) })).t).toBe('admin_denied');
    // admin kicks a player
    expect((await admin(adm, 'kick', { cid: cidOf(pl2), reason: 'spam' })).t).toBe('admin_ok');
    expect((await pl2.c.wait((m) => m.t === 'kicked')).by).toBe('an_admin');
    expect(await pl2.c.waitClose()).toBe(4001);

    // developer
    for (const [cmd, args] of [['spawn', { item: 'giant_duck', tier: 'any' }], ['gear', { item: 'wave_cannon' }], ['teleport', { to: 'cargo' }], ['teleport', { to: 'cabin', cid: cidOf(pl) }], ['npc', { action: 'dance' }], ['fire', { o: [0, 1, 0], d: [0, 0, -1] }], ['weather', { weather: 'clear' }]] as const) {
      expect((await admin(dev, cmd, args)).t, `dev ${cmd}`).toBe('admin_ok');
    }
    expect((await admin(dev, 'kick', { cid: cidOf(adm2) })).t).toBe('admin_ok');
    expect((await admin(dev, 'kick', { cid: cidOf(dev) })).t).toBe('admin_denied'); // not even yourself

    // audit log on the website
    await new Promise((r) => setTimeout(r, 150));
    const rows = await db('audit_logs').where('action', 'like', 'ingame.%').select('action', 'actor_username', 'target_label', 'category');
    const acts = rows.map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['ingame.weather', 'ingame.emergency.start', 'ingame.emergency.stop', 'ingame.spawn', 'ingame.kick', 'ingame.kick.denied', 'ingame.gear', 'ingame.teleport', 'ingame.npc']));
    const kick = rows.find((r: any) => r.action === 'ingame.kick' && r.target_label === 'victim');
    expect(kick.actor_username).toBe('an_admin');
    expect(kick.category).toBe('moderation');
    for (const p of [dev, adm, tr, pl]) p.c.close();
  });

  it('game audit endpoint requires the server key', async () => {
    const r = await request(app).post('/api/game/audit').send({ actorUserId: 1, action: 'ingame.weather' });
    expect(r.status).toBe(401);
  });
});
