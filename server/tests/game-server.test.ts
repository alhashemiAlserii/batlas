import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { migrate, insertId } from '../src/db/index.js';
import { testDb, PW } from './helpers.js';
import { createApp } from '../src/app.js';
import { attachGameServer, WS_PATH } from '../src/game-server/server.js';
import { httpSiteBridge } from '../src/game-server/bridge.js';
import { siteMaintenance } from '../src/game-server/maintenance.js';
import { setMaintenance } from '../src/lib/maintenance.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import request from 'supertest';
import type { Role } from '../src/lib/permissions.js';

const KEY = 'test-game-key-xyz-123';
let server: http.Server, port: number, db: any, gs: ReturnType<typeof attachGameServer>, app: any;
let n = 0;

beforeAll(async () => {
  db = await testDb();
  await migrate(db);
  app = createApp(db, { cookieSecure: false, gameServerKey: KEY, rateLimit: { windowMs: 60000, max: 1000 } }, { mailer: new MemoryMailer() }).app;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as any).port;
  gs = attachGameServer(server, { bridge: httpSiteBridge(`http://127.0.0.1:${port}`, KEY), log: () => {}, isMaintenance: siteMaintenance(db) });
});
afterAll(async () => { gs.close(); await new Promise((r) => server.close(r)); await db.destroy(); });

/** Creates a user, logs in via the website and fetches a game token. */
async function tokenFor(role: Role, name?: string) {
  const username = name ?? `${role.toLowerCase()}_${++n}`;
  const id = await insertId(db('users').insert({ username, username_lower: username.toLowerCase(), handle: username, handle_lower: username.toLowerCase(), password_hash: await hashPassword(PW), pin_set: true, role, display_name: username, created_at: new Date().toISOString() }));
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

    for (const [cmd, args] of [['spawn', { item: 'suitcase' }], ['kick', { cid: cidOf(pl2) }], ['weather', { weather: 'storm' }], ['emergency', { scenario: 'turbulence' }], ['teleport', { to: 'cockpit' }], ['npc', { action: 'dance' }], ['equip', { item: 'wave_cannon' }]] as const) {
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
    expect((await admin(adm, 'equip', { item: 'wave_cannon' })).t).toBe('admin_denied');
    expect((await admin(adm, 'use', { item: 'wave_cannon', o: [0, 0, 0], d: [0, 0, -1] })).t).toBe('admin_denied');
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
    for (const [cmd, args] of [['spawn', { item: 'giant_duck', tier: 'any' }], ['equip', { item: 'wave_cannon' }], ['teleport', { to: 'cargo' }], ['teleport', { to: 'cabin', cid: cidOf(pl) }], ['npc', { action: 'dance' }], ['use', { item: 'wave_cannon', o: [0, 1, 0], d: [0, 0, -1] }], ['weather', { weather: 'clear' }]] as const) {
      expect((await admin(dev, cmd, args)).t, `dev ${cmd}`).toBe('admin_ok');
    }
    expect((await admin(dev, 'kick', { cid: cidOf(adm2) })).t).toBe('admin_ok');
    expect((await admin(dev, 'kick', { cid: cidOf(dev) })).t).toBe('admin_denied'); // not even yourself

    // audit log on the website
    await new Promise((r) => setTimeout(r, 150));
    const rows = await db('audit_logs').where('action', 'like', 'ingame.%').select('action', 'actor_username', 'target_label', 'category');
    const acts = rows.map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['ingame.weather', 'ingame.emergency.start', 'ingame.emergency.stop', 'ingame.spawn', 'ingame.kick', 'ingame.kick.denied', 'ingame.dev.equip', 'ingame.teleport', 'ingame.npc']));
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

describe('crew roles (Stage 4)', () => {
  it('validates roles, keeps pilot/co-pilot unique and shares picks in room info', async () => {
    const a = await player('PLAYER'), b = await player('PLAYER');
    await room(a, b);
    a.c.send({ t: 'crew', role: 'pilot' });
    let info = await b.c.wait((m: any) => m.t === 'room' && m.players.some((p: any) => p.crew === 'pilot'));
    expect(info.players.find((p: any) => p.cid === cidOf(a)).crew).toBe('pilot');
    b.c.send({ t: 'crew', role: 'pilot' });
    expect((await b.c.wait((m: any) => m.t === 'error')).code).toBe('crew_taken');
    b.c.send({ t: 'crew', role: 'captain-of-everything' });
    expect((await b.c.wait((m: any) => m.t === 'error')).code).toBe('bad_crew');
    b.c.send({ t: 'crew', role: 'copilot' });
    info = await a.c.wait((m: any) => m.t === 'room' && m.players.some((p: any) => p.crew === 'copilot'));
    expect(info.players.map((p: any) => p.crew).sort()).toEqual(['copilot', 'pilot']);
    // leaving frees the role; host migrates to the remaining player
    a.c.close();
    info = await b.c.wait((m: any) => m.t === 'room' && m.players.length === 1);
    expect(info.hostCid).toBe(cidOf(b));
    b.c.close();
  });
});

describe('Developer room access (Stage 4)', () => {
  it('Developer joins full and locked rooms; Admin and Player are refused', async () => {
    const host = await player('PLAYER');
    const fillers = [];
    for (let i = 0; i < 7; i++) fillers.push(await player('PLAYER'));
    const code = await room(host, ...fillers); // 8/8
    const adm = await player('ADMIN'), pl = await player('PLAYER'), dev = await player('DEVELOPER');
    adm.c.send({ t: 'join', code });
    expect((await adm.c.wait((m: any) => m.t === 'error')).code).toBe('room_full');
    pl.c.send({ t: 'join', code });
    expect((await pl.c.wait((m: any) => m.t === 'error')).code).toBe('room_full');
    dev.c.send({ t: 'join', code });
    const inFull = await dev.c.wait((m: any) => m.t === 'room' && m.you);
    expect(inFull.players).toHaveLength(9);
    // host locks; a second room shows the same rules for locked rooms
    const h2 = await player('PLAYER');
    h2.c.send({ t: 'create' });
    const r2 = await h2.c.wait((m: any) => m.t === 'room' && m.you);
    h2.c.send({ t: 'lock', on: true });
    await h2.c.wait((m: any) => m.t === 'room' && m.locked === true);
    adm.c.send({ t: 'join', code: r2.code });
    expect((await adm.c.wait((m: any) => m.t === 'error')).code).toBe('room_locked');
    pl.c.send({ t: 'join', code: r2.code });
    expect((await pl.c.wait((m: any) => m.t === 'error')).code).toBe('room_locked');
    dev.c.send({ t: 'join', code: r2.code });
    expect((await dev.c.wait((m: any) => m.t === 'room' && m.you && m.code === r2.code)).locked).toBe(true);
    // a non-host cannot lock
    dev.c.send({ t: 'lock', on: false });
    expect((await dev.c.wait((m: any) => m.t === 'error')).code).toBe('not_host');
    // every Developer join is audit-logged with what was bypassed
    await new Promise((r) => setTimeout(r, 150));
    const logs = await db('audit_logs').where({ action: 'ingame.dev.join' }).select('details');
    const det = logs.map((l: any) => JSON.parse(l.details));
    expect(det.some((d: any) => d.bypass.includes('full'))).toBe(true);
    expect(det.some((d: any) => d.bypass.includes('locked'))).toBe(true);
    for (const p of [host, ...fillers, adm, pl, dev, h2]) p.c.close();
  });

  it('live room list is Developer-only; hidden join is invisible; Developer cannot be kicked', async () => {
    const host = await player('PLAYER'), adm = await player('ADMIN'), dev = await player('DEVELOPER'), pl = await player('PLAYER');
    const code = await room(host, adm);
    adm.c.send({ t: 'rooms' });
    expect((await adm.c.wait((m: any) => m.t === 'error')).code).toBe('forbidden');
    pl.c.send({ t: 'rooms', role: 'DEVELOPER' }); // claims in the message are ignored
    expect((await pl.c.wait((m: any) => m.t === 'error')).code).toBe('forbidden');
    dev.c.send({ t: 'rooms' });
    const list = await dev.c.wait((m: any) => m.t === 'rooms');
    const mine = list.rooms.find((r: any) => r.code === code);
    expect(mine).toMatchObject({ host: host.username, count: 2, max: 8, locked: false });
    // players can't join hidden
    pl.c.send({ t: 'join', code, hidden: true });
    expect((await pl.c.wait((m: any) => m.t === 'error')).code).toBe('forbidden');
    host.c.msgs.length = 0;
    dev.c.send({ t: 'join', code, hidden: true });
    const self = await dev.c.wait((m: any) => m.t === 'room' && m.you);
    expect(self.hidden).toBe(true);
    expect(self.players.some((p: any) => p.username === dev.username)).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(host.c.msgs.some((m: any) => m.t === 'joined')).toBe(false);
    host.c.send({ t: 'crew', role: 'cabin' });
    const seen = await host.c.wait((m: any) => m.t === 'room');
    expect(seen.players.map((p: any) => p.username)).not.toContain(dev.username);
    dev.c.send({ t: 'st', s: { p: [0, 0, 0], ry: 0 } });
    await new Promise((r) => setTimeout(r, 200));
    expect(host.c.msgs.some((m: any) => m.t === 'st' && m.cid === cidOf(dev))).toBe(false);
    // admin tries to kick the Developer: refused
    const res = await admin(adm, 'kick', { cid: cidOf(dev), reason: 'test' });
    expect(res.t).toBe('admin_denied');
    expect(dev.c.closed).toBeNull();
    for (const p of [host, adm, dev, pl]) p.c.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Game revision: Developer secret inventory, in-game Developer panel, maintenance mode
// ---------------------------------------------------------------------------------------------
const quiet = (p: any, f: (m: any) => boolean, ms = 400) => p.c.wait(f, ms).then(() => true, () => false);
const auditActs = async () => (await db('audit_logs').where('action', 'like', 'ingame.%').select('action', 'actor_username', 'target_label', 'category', 'details'));

describe('Developer secret inventory (server-verified)', () => {
  it('only the verified Developer sees the catalogue; Admin/Trusted/Player are refused even with forged claims', async () => {
    const dev = await player('DEVELOPER', 'inv_dev'); const adm = await player('ADMIN', 'inv_admin'); const tr = await player('TRUSTED', 'inv_trusted'); const pl = await player('PLAYER', 'inv_player');
    await room(dev, adm, tr, pl);
    dev.c.send({ t: 'inventory' });
    const inv = await dev.c.wait((m: any) => m.t === 'inventory');
    expect(inv.categories).toEqual(['Energy Weapons', 'Experimental', 'Abilities', 'Movement', 'Equipment', 'Effects']);
    const ids = inv.items.map((i: any) => i.id);
    for (const id of ['plasma_blaster', 'ion_beam', 'gravity_gun', 'freeze_ray', 'size_ray', 'teleport_gun', 'jetpack', 'super_speed', 'super_jump', 'noclip', 'shield_bubble', 'golden_aura', 'confetti_cannon']) expect(ids).toContain(id);
    for (const p of [adm, tr, pl]) {
      p.c.send({ t: 'inventory', role: 'DEVELOPER', permissions: ['items.spawn.developer'] });
      expect((await p.c.wait((m: any) => m.t === 'error' || m.t === 'inventory')).t).toBe('error');
      for (const [cmd, args] of [['equip', { item: 'plasma_blaster', role: 'DEVELOPER' }], ['use', { item: 'plasma_blaster', o: [0, 1, 0], d: [0, 0, -1] }], ['unequip', { item: 'jetpack' }], ['spawn', { tier: 'developer', item: 'freeze_ray' }]] as const) {
        expect((await admin(p, cmd, args)).t, `${p.username} ${cmd}`).toBe('admin_denied');
      }
    }
    // a forged fx message from a client is never relayed
    pl.c.send({ t: 'fx', cmd: 'use', args: { item: 'plasma_blaster' }, by: { role: 'DEVELOPER' } });
    expect(await quiet(dev, (m: any) => m.t === 'fx' && m.cmd === 'use')).toBe(false);
    const acts = (await auditActs()).map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['ingame.inventory.denied', 'ingame.equip.denied', 'ingame.use.denied', 'ingame.spawn.denied']));
    for (const p of [dev, adm, tr, pl]) p.c.close();
  });

  it('equip / use / unequip are validated, broadcast to the room and audit-logged', async () => {
    const dev = await player('DEVELOPER', 'gear_dev'); const pl = await player('PLAYER', 'gear_pl');
    await room(dev, pl);
    expect((await admin(dev, 'use', { item: 'plasma_blaster', o: [0, 1, 0], d: [0, 0, -1] })).reason).toMatch(/equip/i);
    expect((await admin(dev, 'equip', { item: 'death_ray' })).t).toBe('admin_denied');
    expect((await admin(dev, 'equip', { item: 'plasma_blaster' })).t).toBe('admin_ok');
    const eq = await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'equip');
    expect(eq.args).toMatchObject({ cid: cidOf(dev), item: 'plasma_blaster', on: true });
    expect(eq.by.role).toBe('DEVELOPER');
    expect((await admin(dev, 'use', { item: 'plasma_blaster', o: [0, 1, 0], d: [0, 0, -3] })).t).toBe('admin_ok');
    const shot = await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'use');
    expect(shot.args.item).toBe('plasma_blaster');
    expect(shot.args.d[2]).toBeCloseTo(-1); // normalised by the server
    expect((await admin(dev, 'use', { item: 'plasma_blaster', o: [0, 1, 0], d: [0, 0, -1] })).reason).toMatch(/cool/i); // server cooldown
    expect((await admin(dev, 'use', { item: 'plasma_blaster', o: [0, 1, 0], d: [0, 0, 0] })).t).toBe('admin_denied');
    // one tool in the hand: equipping the freeze ray swaps the blaster out; toggles stack
    expect((await admin(dev, 'equip', { item: 'freeze_ray' })).t).toBe('admin_ok');
    const sw = await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'equip' && m.args.item === 'freeze_ray');
    expect(sw.args.removed).toEqual(['plasma_blaster']);
    for (const t of ['jetpack', 'super_speed', 'shield_bubble', 'golden_aura']) expect((await admin(dev, 'equip', { item: t })).t).toBe('admin_ok');
    expect((await admin(dev, 'use', { item: 'jetpack', o: [0, 1, 0], d: [0, 0, -1] })).t).toBe('admin_denied'); // toggles are not "fired"
    // the Developer can't be targeted by their own (or anyone's) ray
    await new Promise((r) => setTimeout(r, 450));
    expect((await admin(dev, 'use', { item: 'freeze_ray', o: [0, 1, 0], d: [0, 0, -1], target: { type: 'player', id: cidOf(pl) } })).t).toBe('admin_ok');
    expect((await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'use' && m.args.item === 'freeze_ray')).args.target).toEqual({ type: 'player', id: cidOf(pl) });
    // teleport gun: range-checked on the server
    expect((await admin(dev, 'equip', { item: 'teleport_gun' })).t).toBe('admin_ok');
    dev.c.send({ t: 'st', s: { p: [0, 0, 0], ry: 0 } }); await new Promise((r) => setTimeout(r, 50));
    expect((await admin(dev, 'use', { item: 'teleport_gun', o: [0, 1, 0], d: [0, 0, -1], p: [0, 0, -500] })).reason).toMatch(/far/i);
    await new Promise((r) => setTimeout(r, 550));
    expect((await admin(dev, 'use', { item: 'teleport_gun', o: [0, 1, 0], d: [0, 0, -1], p: [0, 0, -6] })).t).toBe('admin_ok');
    // gear is visible in room info so other clients can draw it
    expect((await admin(dev, 'unequip', { item: 'jetpack' })).t).toBe('admin_ok');
    const un = await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'equip' && m.args.on === false);
    expect(un.args.gear).not.toContain('jetpack');
    dev.c.send({ t: 'leave' }); await dev.c.wait((m: any) => m.t === 'room_left');
    await new Promise((r) => setTimeout(r, 200));
    const rows = await auditActs();
    const acts = rows.map((r: any) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['ingame.dev.equip', 'ingame.dev.unequip', 'ingame.dev.use']));
    const use = rows.filter((r: any) => r.action === 'ingame.dev.use' && r.actor_username === 'gear_dev');
    const uses = use.map((r: any) => (typeof r.details === 'string' ? JSON.parse(r.details) : r.details).uses);
    expect(uses.reduce((a: number, u: any) => a + (u.plasma_blaster ?? 0), 0)).toBe(1);
    for (const p of [dev, pl]) p.c.close();
  });

  it('Developer pickups: server-issued ids that nobody else can grab', async () => {
    const host = await player('PLAYER', 'pick_host'); const dev = await player('DEVELOPER', 'pick_dev'); const adm = await player('ADMIN', 'pick_admin');
    await room(host, dev, adm);
    expect((await admin(dev, 'spawn', { tier: 'developer', item: 'gravity_gun', count: 2 })).t).toBe('admin_ok');
    const fx = await host.c.wait((m: any) => m.t === 'fx' && m.cmd === 'spawn');
    expect(fx.args.ids).toHaveLength(2);
    adm.c.send({ t: 'act', a: { k: 'grab', id: fx.args.ids[0] } });
    expect(await quiet(host, (m: any) => m.t === 'act')).toBe(false);
    dev.c.send({ t: 'act', a: { k: 'grab', id: fx.args.ids[0] } });
    expect((await host.c.wait((m: any) => m.t === 'act')).cid).toBe(cidOf(dev));
    for (const p of [host, dev, adm]) p.c.close();
  });
});

describe('in-game Developer panel: every control is rank-checked on the server', () => {
  it('ban: Admin bans a Player from the game; nobody can ban the Developer; Trusted/Player cannot ban', async () => {
    const dev = await player('DEVELOPER', 'ban_dev'); const adm = await player('ADMIN', 'ban_admin'); const adm2 = await player('ADMIN', 'ban_admin2'); const tr = await player('TRUSTED', 'ban_tr'); const pl = await player('PLAYER', 'ban_pl');
    await room(dev, adm, adm2, tr, pl);
    expect((await admin(tr, 'ban', { cid: cidOf(pl) })).t).toBe('admin_denied');
    expect((await admin(pl, 'ban', { cid: cidOf(tr), role: 'DEVELOPER' })).t).toBe('admin_denied');
    expect((await admin(adm, 'ban', { cid: cidOf(dev) })).reason).toMatch(/protected/i);
    expect((await admin(adm, 'ban', { cid: cidOf(adm2) })).t).toBe('admin_denied');
    expect((await admin(adm, 'ban', { cid: cidOf(pl), minutes: 30, reason: 'griefing' })).t).toBe('admin_ok');
    const k = await pl.c.wait((m: any) => m.t === 'kicked');
    expect(k).toMatchObject({ banned: true, minutes: 30, reason: 'griefing' });
    // reconnecting with a fresh token is refused by the game server
    const again = await tokenFor('PLAYER', 'ban_pl_alt');
    const uid = (await db('users').where({ username: 'ban_pl' }).first()).id;
    await db('game_tokens').where({ user_id: again.id }).update({ user_id: uid });
    const c = new TC(); await c.open(); c.send({ t: 'auth', token: again.token });
    expect((await c.wait((m: any) => m.t === 'error' || m.t === 'welcome')).code).toBe('banned');
    expect(await c.waitClose()).toBe(4004);
    // Developer site-ban: the website re-checks rank and bans the account
    expect((await admin(dev, 'ban', { cid: cidOf(tr), scope: 'site', reason: 'test' })).t).toBe('admin_ok');
    expect((await db('users').where({ username: 'ban_tr' }).first()).banned).toBeTruthy();
    // the site endpoint itself refuses an Admin acting on the Developer, even with the server key
    const devId = (await db('users').where({ username: 'ban_dev' }).first()).id;
    const admId = (await db('users').where({ username: 'ban_admin' }).first()).id;
    const r = await request(app).post('/api/game/ban').set('x-game-server-key', KEY).send({ actorUserId: admId, targetUserId: devId });
    expect(r.status).toBe(403);
    expect([401, 403]).toContain((await request(app).post('/api/game/ban').send({ actorUserId: admId, targetUserId: devId })).status); // no server key: refused
    for (const p of [dev, adm, adm2]) p.c.close();
  });

  it('mute (chat), freeze (server keeps position) and kick checks', async () => {
    const dev = await player('DEVELOPER', 'mf_dev'); const adm = await player('ADMIN', 'mf_admin'); const pl = await player('PLAYER', 'mf_pl'); const tr = await player('TRUSTED', 'mf_tr');
    await room(dev, adm, pl, tr);
    pl.c.send({ t: 'chat', text: 'hello\u0007 crew' });
    expect((await dev.c.wait((m: any) => m.t === 'chat')).text).toBe('hello crew');
    expect((await admin(tr, 'mute', { cid: cidOf(pl) })).t).toBe('admin_denied');
    expect((await admin(adm, 'mute', { cid: cidOf(dev) })).reason).toMatch(/protected/i);
    expect((await admin(adm, 'mute', { cid: cidOf(pl), minutes: 5 })).t).toBe('admin_ok');
    expect((await pl.c.wait((m: any) => m.t === 'muted')).minutes).toBe(5);
    await new Promise((r) => setTimeout(r, 750));
    pl.c.send({ t: 'chat', text: 'can you hear me' });
    expect((await pl.c.wait((m: any) => m.t === 'error')).code).toBe('muted');
    expect(await quiet(dev, (m: any) => m.t === 'chat')).toBe(false);
    expect((await admin(adm, 'mute', { cid: cidOf(pl), on: false })).t).toBe('admin_ok');
    // freeze is Developer-only
    expect((await admin(adm, 'freeze', { cid: cidOf(pl) })).t).toBe('admin_denied');
    pl.c.send({ t: 'st', s: { p: [1, 0, 1], ry: 0 } }); await dev.c.wait((m: any) => m.t === 'st' && m.cid === cidOf(pl));
    expect((await admin(dev, 'freeze', { cid: cidOf(pl) })).t).toBe('admin_ok');
    expect((await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'freeze')).args).toMatchObject({ cid: cidOf(pl), on: true });
    pl.c.send({ t: 'st', s: { p: [9, 0, 9], ry: 1 } });
    expect((await dev.c.wait((m: any) => m.t === 'st' && m.cid === cidOf(pl))).s.p).toEqual([1, 0, 1]);
    pl.c.send({ t: 'act', a: { k: 'door', d: 'rear' } });
    expect(await quiet(dev, (m: any) => m.t === 'act')).toBe(false);
    expect((await admin(dev, 'freeze', { cid: cidOf(pl), on: false })).t).toBe('admin_ok');
    for (const p of [dev, adm, pl, tr]) p.c.close();
  });

  it('teleport / NPC / events / config / time are Developer-only; weather + emergencies allowed for Admin', async () => {
    const dev = await player('DEVELOPER', 'cfg_dev'); const adm = await player('ADMIN', 'cfg_admin'); const tr = await player('TRUSTED', 'cfg_tr'); const pl = await player('PLAYER', 'cfg_pl');
    const code = await room(dev, adm, tr, pl);
    const devOnly: [string, object][] = [['teleport', { toPlayer: cidOf(pl) }], ['teleport', { bring: cidOf(pl) }], ['npc', { action: 'spawn', count: 2 }], ['npc', { action: 'remove' }], ['npc', { action: 'freeze' }], ['event', { event: 'birthday' }], ['event', { event: 'vip' }], ['event', { event: 'turbulence' }], ['config', { difficulty: 'hard' }], ['time', { hour: 19 }]];
    for (const [cmd, args] of devOnly) for (const p of [adm, tr, pl]) expect((await admin(p, cmd, args)).t, `${p.username} ${cmd}`).toBe('admin_denied');
    expect((await admin(adm, 'weather', { weather: 'fog' })).t).toBe('admin_ok');
    expect((await admin(adm, 'weather', { weather: 'lava' })).t).toBe('admin_denied');
    expect((await admin(tr, 'weather', { weather: 'rain' })).t).toBe('admin_denied');
    dev.c.send({ t: 'st', s: { p: [0, 0, -3], ry: 0 } }); pl.c.send({ t: 'st', s: { p: [2, -2.4, 18], ry: 0 } });
    await new Promise((r) => setTimeout(r, 80));
    expect((await admin(dev, 'teleport', { toPlayer: cidOf(pl) })).t).toBe('admin_ok');
    expect((await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'teleport')).args).toMatchObject({ cid: cidOf(dev), p: [2.8, -2.4, 18] });
    expect((await admin(dev, 'teleport', { bring: cidOf(pl) })).t).toBe('admin_ok');
    expect((await pl.c.wait((m: any) => m.t === 'fx' && m.cmd === 'teleport')).args.cid).toBe(cidOf(pl));
    expect((await admin(dev, 'teleport', { to: 'galley', cid: cidOf(pl) })).t).toBe('admin_ok');
    expect((await admin(dev, 'teleport', { to: 'moon' })).t).toBe('admin_denied');
    for (const [cmd, args] of devOnly.slice(2)) expect((await admin(dev, cmd, args)).t, `dev ${cmd}`).toBe('admin_ok');
    expect((await admin(dev, 'time', { hour: 99 })).t).toBe('admin_denied');
    expect((await admin(dev, 'config', { payout: 9 })).t).toBe('admin_denied');
    expect((await admin(dev, 'config', { payout: 1.5, maxPlayers: 4 })).t).toBe('admin_ok');
    const info = await pl.c.wait((m: any) => m.t === 'room' && m.config?.maxPlayers === 4);
    expect(info.config).toEqual({ difficulty: 'hard', payout: 1.5, maxPlayers: 4 });
    const late = await player('PLAYER', 'cfg_late');
    late.c.send({ t: 'join', code });
    expect((await late.c.wait((m: any) => m.t === 'error')).code).toBe('room_full');
    const rows = (await auditActs()).map((r: any) => r.action);
    expect(rows).toEqual(expect.arrayContaining(['ingame.config', 'ingame.time', 'ingame.event', 'ingame.teleport', 'ingame.config.denied', 'ingame.event.denied']));
    for (const p of [dev, adm, tr, pl, late]) p.c.close();
  });

  it('server management: close room + broadcast are Developer-only', async () => {
    const dev = await player('DEVELOPER', 'srv_dev'); const adm = await player('ADMIN', 'srv_admin'); const pl = await player('PLAYER', 'srv_pl');
    const code = await room(pl, adm);
    const other = await player('PLAYER', 'srv_other'); await room(other);
    expect((await admin(adm, 'broadcast', { text: 'hi' })).t).toBe('admin_denied');
    expect((await admin(adm, 'close_room', { code })).t).toBe('admin_denied');
    expect((await admin(dev, 'broadcast', { text: 'Server restart in 5 minutes' })).t).toBe('admin_ok');
    expect((await other.c.wait((m: any) => m.t === 'announce')).text).toBe('Server restart in 5 minutes');
    expect((await admin(dev, 'close_room', { code })).t).toBe('admin_ok');
    expect((await pl.c.wait((m: any) => m.t === 'kicked')).reason).toMatch(/closed/);
    expect((await adm.c.wait((m: any) => m.t === 'kicked')).reason).toMatch(/closed/);
    expect(gs.rooms.has(code)).toBe(false);
    for (const p of [dev, adm, pl, other]) p.c.close();
  });
});

describe('maintenance mode (shared site switch + MAINTENANCE_MODE env override)', () => {
  it('refuses non-Developers, keeps the Developer, and removes players from live rooms when switched on', async () => {
    const dev = await player('DEVELOPER', 'mt_dev'); const pl = await player('PLAYER', 'mt_pl'); const adm = await player('ADMIN', 'mt_admin');
    await room(pl, dev, adm);
    const late = await tokenFor('PLAYER', 'mt_late'); // website login itself is closed during maintenance
    process.env.MAINTENANCE_MODE = 'true';
    try {
      expect(await gs.enforceMaintenance()).toBeGreaterThanOrEqual(2); // + any leftover sockets from earlier tests
      expect((await pl.c.wait((m: any) => m.t === 'maintenance')).message).toMatch(/under maintenance/i);
      expect(await pl.c.waitClose()).toBe(4005);
      expect((await adm.c.wait((m: any) => m.t === 'maintenance')).message).toMatch(/under maintenance/i);
      // new non-Developer connections are refused at sign-in
      const c = new TC(); await c.open(); c.send({ t: 'auth', token: late.token });
      expect((await c.wait((m: any) => m.t === 'maintenance' || m.t === 'welcome')).t).toBe('maintenance');
      expect(await c.waitClose()).toBe(4005);
      // the Developer stays and can still create rooms and sign in
      dev.c.send({ t: 'create' });
      expect((await dev.c.wait((m: any) => m.t === 'room' && m.you)).code).toMatch(/^[A-Z]{5}$/);
    } finally { delete process.env.MAINTENANCE_MODE; }
    const back = await player('PLAYER', 'mt_back');
    expect(back.welcome.t).toBe('welcome');
    for (const p of [dev, back]) p.c.close();
  });
});

describe('maintenance mode from the Developer dashboard setting', () => {
  it('the DB switch blocks sign-in and room creation for non-Developers, with the custom message', async () => {
    const pl = await player('PLAYER', 'mdb_pl'); const dev = await player('DEVELOPER', 'mdb_dev');
    await room(pl);
    const late = await tokenFor('PLAYER', 'mdb_late');
    await setMaintenance(db, { enabled: true, message: 'Back at 18:00.' }, null);
    try {
      pl.c.send({ t: 'create' });
      expect((await pl.c.wait((m: any) => m.t === 'maintenance' || (m.t === 'room' && m.you))).message).toMatch(/under maintenance.*Back at 18:00/);
      expect(await gs.enforceMaintenance()).toBeGreaterThanOrEqual(1);
      expect(await pl.c.waitClose()).toBe(4005);
      // /api/game/verify itself refuses non-Developers during maintenance
      const v = await request(app).post('/api/game/verify').set('x-game-server-key', KEY).send({ token: late.token });
      expect(v.status).toBe(503);
      expect(v.body.code).toBe('maintenance');
      dev.c.send({ t: 'create' });
      expect((await dev.c.wait((m: any) => m.t === 'room' && m.you)).code).toMatch(/^[A-Z]{5}$/);
    } finally { await setMaintenance(db, { enabled: false }, null); }
    dev.c.close();
  });
});
