import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { migrate, insertId } from '../src/db/index.js';
import { testDb } from './helpers.js';
import { createApp } from '../src/app.js';
import { attachGameServer, WS_PATH } from '../src/game-server/server.js';
import { httpSiteBridge } from '../src/game-server/bridge.js';
import { siteMaintenance } from '../src/game-server/maintenance.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import request from 'supertest';
import type { Role } from '../src/lib/permissions.js';

const KEY = 'test-game-key-xyz-123';
let server: http.Server, port: number, db: any, gs: ReturnType<typeof attachGameServer>, app: any;
let clock = 1_000_000_000_000;
const PW = 'correct-horse-battery';
let n = 0;

beforeAll(async () => {
  db = await testDb();
  await migrate(db);
  app = createApp(db, { cookieSecure: false, gameServerKey: KEY, rateLimit: { windowMs: 60000, max: 1000 } }, { mailer: new MemoryMailer() }).app;
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as any).port;
  gs = attachGameServer(server, { bridge: httpSiteBridge(`http://127.0.0.1:${port}`, KEY), log: () => {}, isMaintenance: siteMaintenance(db), now: () => clock });
});
afterAll(async () => { gs.close(); await new Promise((r) => server.close(r)); await db.destroy(); });

/** Creates a user, logs in via the website and fetches a game token. */
async function tokenFor(role: Role, name?: string): Promise<{ id: number; username: string; token: string; agent: any; csrf: string }> {
  const username = name ?? `${role.toLowerCase()}_${++n}`;
  const id = await insertId(db('users').insert({ username, username_lower: username.toLowerCase(), password_hash: await hashPassword(PW), role, display_name: username, created_at: new Date().toISOString() }));
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/csrf')).body.csrfToken;
  const login = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: username, password: PW });
  const c2 = (([] as string[]).concat(login.headers['set-cookie'] as any).find((s) => s.startsWith('csrf=')) ?? '').split(';')[0].slice(5) || csrf;
  const t = await agent.post('/api/game/token').set('x-csrf-token', decodeURIComponent(c2)).send({ game: 'sky-crew' });
  expect(t.status).toBe(200);
  return { id: Number(id), username, token: t.body.token as string, agent, csrf: decodeURIComponent(c2) };
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


import { computeSalary, minAirborneSec, SALARY_CAP, CLASSES } from '../src/game-server/shop.js';
import { balanceOf } from '../src/lib/wallet.js';

const px = (n: number, lost = 0) => Array.from({ length: n }, (_, i) => [i + 1, 0, 0, 0, 0, i < lost ? 'lost' : 'seated', '', 80, 0, '', '', 1]);
const world = (seed: number, ph: string, extra: any = {}) => ({ t: 'world', w: { seed, ph, route: 'CRP', px: px(16, extra.lost ?? 0), res: extra.res ?? null } });
let seedN = 100;
/** Fly a whole flight through the host's world snapshots, with the server clock advanced by `airSec`. */
async function fly(host: any, airSec: number, res: any, lost = 0) {
  const seed = ++seedN;
  host.c.send(world(seed, 'boarding')); host.c.send(world(seed, 'taxi'));
  await new Promise((r) => setTimeout(r, 50));
  host.c.send(world(seed, 'climb'));
  await new Promise((r) => setTimeout(r, 50));
  clock += airSec * 1000;
  host.c.send(world(seed, 'landed', { lost }));
  await new Promise((r) => setTimeout(r, 50));
  host.c.send(world(seed, 'results', { res, lost }));
  return seed;
}
const GOOD = { landing: 'good', landedAt: 'CRP', crashed: false, payout: 999999, total: 999999 };
const buy = (u: any, item: string, purchaseId = `p${Math.random().toString(36).slice(2, 12)}`) => u.agent.post('/api/game/sky-crew/shop/buy').set('x-csrf-token', u.csrf).send({ item, purchaseId });
const grantWs = (dev: any, target: any, args: any) => admin(dev, 'wallet', { cid: cidOf(target), ...args });

describe('salary (server-computed from its own room tracking)', () => {
  it('pays every crew member the server formula, ignoring the payout the browser shows', async () => {
    const host = await player('PLAYER'), mate = await player('PLAYER');
    await room(host, mate);
    await fly(host, 200, GOOD);
    const expected = computeSalary({ route: 'CRP', airborneSec: 200, paxBoarded: 16, paxLost: 0, landing: 'good', crashed: false, arrived: true }).amount;
    const [a, b] = await Promise.all([host.c.wait((m: any) => m.t === 'salary'), mate.c.wait((m: any) => m.t === 'salary')]);
    expect(expected).toBeGreaterThan(300); expect(expected).toBeLessThan(SALARY_CAP);
    expect(a.amount).toBe(expected); expect(b.amount).toBe(expected);
    expect(await balanceOf(db, host.id)).toBe(expected); expect(await balanceOf(db, mate.id)).toBe(expected);
    const audit = await db('audit_logs').where({ action: 'ingame.salary' }).whereIn('target_id', [String(host.id), String(mate.id)]);
    expect(audit.length).toBe(2);
    host.c.close(); mate.c.close();
  });
  it('lost passengers and a hard landing lower the salary; a crash pays nothing', async () => {
    const host = await player('PLAYER');
    await room(host);
    await fly(host, 200, { landing: 'hard', landedAt: 'CRP', crashed: false }, 3);
    const s = await host.c.wait((m: any) => m.t === 'salary');
    expect(s.amount).toBe(computeSalary({ route: 'CRP', airborneSec: 200, paxBoarded: 16, paxLost: 3, landing: 'hard', crashed: false, arrived: true }).amount);
    await fly(host, 200, { landing: 'crash', landedAt: null, crashed: true });
    const s2 = await host.c.wait((m: any) => m.t === 'salary');
    expect(s2.amount).toBe(0);
    host.c.close();
  });
  it('refuses an implausibly short flight (faster than the aircraft can fly the route)', async () => {
    const host = await player('PLAYER');
    await room(host);
    await fly(host, minAirborneSec('CRP') - 5, GOOD);
    const s = await host.c.wait((m: any) => m.t === 'salary');
    expect(s.amount).toBe(0); expect(s.reason).toMatch(/too short/);
    expect(await balanceOf(db, host.id)).toBe(0);
    host.c.close();
  });
  it('pays each flight once: a replayed results snapshot and a replayed salary call change nothing', async () => {
    const host = await player('PLAYER');
    await room(host);
    const seed = await fly(host, 200, GOOD);
    const s = await host.c.wait((m: any) => m.t === 'salary');
    const bal = await balanceOf(db, host.id);
    expect(bal).toBe(s.amount);
    host.c.send(world(seed, 'results', { res: GOOD })); host.c.send(world(seed, 'results', { res: GOOD }));
    await expect(host.c.wait((m: any) => m.t === 'salary', 600)).rejects.toThrow();
    const key = (await db('wallet_ledger').where({ user_id: host.id, kind: 'salary' }).first()).ref;
    const again = await request(app).post('/api/game/salary').set('x-game-server-key', KEY).send({ flightKey: key, userIds: [host.id], amount: 1000 });
    expect(again.body.paid[0].duplicate).toBe(true);
    expect(await balanceOf(db, host.id)).toBe(bal);
    expect((await db('wallet_ledger').where({ user_id: host.id, kind: 'salary' })).length).toBe(1);
    host.c.close();
  });
  it('players who join after takeoff are not paid for that flight', async () => {
    const host = await player('PLAYER'), late = await player('PLAYER');
    const code = await room(host);
    const seed = ++seedN;
    host.c.send(world(seed, 'boarding')); host.c.send(world(seed, 'climb'));
    await new Promise((r) => setTimeout(r, 50));
    late.c.send({ t: 'join', code }); await late.c.wait((m: any) => m.t === 'room' && m.you);
    clock += 200_000;
    host.c.send(world(seed, 'landed')); host.c.send(world(seed, 'results', { res: GOOD }));
    const [a, b] = await Promise.all([host.c.wait((m: any) => m.t === 'salary'), late.c.wait((m: any) => m.t === 'salary')]);
    expect(a.amount).toBeGreaterThan(0); expect(b.amount).toBe(0); expect(b.reason).toMatch(/after takeoff/);
    expect(await balanceOf(db, late.id)).toBe(0);
    host.c.close(); late.c.close();
  });
  it('the salary endpoint needs the game-server key and caps the amount', async () => {
    const u = await tokenFor('PLAYER');
    expect([401, 403]).toContain((await request(app).post('/api/game/salary').send({ flightKey: 'x:1:1', userIds: [u.id], amount: 10 })).status);
    expect((await request(app).post('/api/game/salary').set('x-game-server-key', 'wrong').send({ flightKey: 'x:1:1', userIds: [u.id], amount: 10 })).status).toBe(401);
    expect((await request(app).post('/api/game/salary').set('x-game-server-key', KEY).send({ flightKey: 'x:1:2', userIds: [u.id], amount: SALARY_CAP + 1 })).status).toBe(400);
    expect(await balanceOf(db, u.id)).toBe(0);
  });
});

describe('shop + wallet (server-verified purchases)', () => {
  it('refuses a purchase without enough credits and leaves the balance alone', async () => {
    const u = await tokenFor('PLAYER');
    const r = await buy(u, 'class:ace_pilot');
    expect(r.status).toBe(402); expect(r.body.code).toBe('insufficient_funds');
    expect(await balanceOf(db, u.id)).toBe(0);
    expect(await db('owned_items').where({ user_id: u.id })).toHaveLength(0);
  });
  it('Developer grants credits; buying is charged once (retries and repeat buys are no-ops)', async () => {
    const dev = await player('DEVELOPER'), p = await player('PLAYER');
    await room(dev, p);
    expect((await grantWs(dev, p, { credits: 2000 })).t).toBe('admin_ok');
    expect((await p.c.wait((m: any) => m.t === 'wallet')).balance).toBe(2000);
    const pid = 'retry-abc-123';
    const r1 = await buy(p, 'class:cabin_pro', pid);
    expect(r1.status).toBe(200); expect(r1.body.balance).toBe(1000);
    const r2 = await buy(p, 'class:cabin_pro', pid); // network retry
    const r3 = await buy(p, 'class:cabin_pro'); // second click
    expect(r2.body.already).toBe(true); expect(r3.body.already).toBe(true);
    expect(await balanceOf(db, p.id)).toBe(1000);
    expect((await db('wallet_ledger').where({ user_id: p.id, kind: 'purchase' })).length).toBe(1);
    const w = await p.agent.get('/api/game/sky-crew/wallet');
    expect(w.body.balance).toBe(1000); expect(w.body.owned).toContain('class:cabin_pro');
    dev.c.close(); p.c.close();
  });
  it('parallel purchases never overspend or double-charge (atomic)', async () => {
    const dev = await player('DEVELOPER'), p = await player('PLAYER');
    await room(dev, p);
    await grantWs(dev, p, { credits: 2500 }); await p.c.wait((m: any) => m.t === 'wallet');
    // 4 different classes (1000 + 1000 + 1200 + 1200) and the same outfit 5 times, all at once
    const rs = await Promise.all([...['class:cabin_pro', 'class:baggage', 'class:mechanic', 'class:navigator'].map((k) => buy(p, k)), ...Array.from({ length: 5 }, () => buy(p, 'outfit:attendant'))]);
    const bal = await balanceOf(db, p.id);
    expect(bal).toBeGreaterThanOrEqual(0);
    const ledger = await db('wallet_ledger').where({ user_id: p.id });
    expect(ledger.reduce((a: number, r: any) => a + Number(r.delta), 0)).toBe(bal); // ledger and balance agree
    expect(ledger.filter((r: any) => String(r.ref).startsWith('outfit:attendant')).length).toBe(1); // charged once
    const owned = (await db('owned_items').where({ user_id: p.id })).map((r: any) => r.item_key);
    const spent = 2500 - bal;
    const prices: Record<string, number> = { 'class:cabin_pro': 1000, 'class:baggage': 1000, 'class:mechanic': 1200, 'class:navigator': 1200, 'outfit:attendant': 300 };
    expect(owned.reduce((a: number, k: string) => a + prices[k], 0)).toBe(spent);
    expect(rs.some((r) => r.status === 402)).toBe(true);
    dev.c.close(); p.c.close();
  });
  it('unknown items are refused and the Developer owns everything for free', async () => {
    const u = await tokenFor('PLAYER');
    expect((await buy(u, 'class:god_mode')).status).toBe(404);
    const d = await tokenFor('DEVELOPER');
    const r = await buy(d, 'outfit:dino');
    expect(r.body.already).toBe(true); expect(await balanceOf(db, d.id)).toBe(0);
  });
  it('outfit saving checks ownership', async () => {
    const u = await tokenFor('PLAYER');
    const put = (outfit: any) => u.agent.put('/api/game/sky-crew/outfit').set('x-csrf-token', u.csrf).send({ outfit });
    expect((await put({ outfit: 'hoodie', hat: 'cap', color: 2, skin: 3 })).status).toBe(200);
    expect((await put({ outfit: 'dino', hat: 'none', color: 0, skin: 0 })).status).toBe(403);
    expect((await put({ outfit: 'hoodie', hat: 'tophat', color: 0, skin: 0 })).status).toBe(403);
    expect((await put({ outfit: 'hoodie', hat: 'cap', color: 9, skin: 0 })).status).toBe(403);
    expect((await put({ outfit: 'robot', hat: 'cap', color: 0, skin: 0 })).status).toBe(400);
  });
});

describe('classes + forged economy messages', () => {
  it('a class must be owned (forged picks refused + audited) and picked before takeoff', async () => {
    const host = await player('PLAYER'), mate = await player('PLAYER');
    await room(host, mate);
    host.c.send({ t: 'class', id: 'ace_pilot', owned: true, price: 0 });
    expect((await host.c.wait((m: any) => m.t === 'error')).code).toBe('not_owned');
    host.c.send({ t: 'class', id: 'god_mode' });
    expect((await host.c.wait((m: any) => m.t === 'error')).code).toBe('bad_class');
    await new Promise((r) => setTimeout(r, 300)); // audit entries are written asynchronously
    expect((await db('audit_logs').where({ action: 'ingame.class.denied', actor_id: host.id })).length).toBe(2);
    host.c.send({ t: 'outfit', outfit: { outfit: 'dino', hat: 'none', color: 0, skin: 0 } });
    expect((await host.c.wait((m: any) => m.t === 'error')).code).toBe('not_owned');
    await db('owned_items').insert({ user_id: host.id, item_key: 'class:ace_pilot', source: 'grant', created_at: new Date().toISOString() });
    host.c.send({ t: 'class', id: 'ace_pilot' });
    expect((await host.c.wait((m: any) => m.t === 'class')).id).toBe('ace_pilot');
    const seen = await mate.c.wait((m: any) => m.t === 'room' && m.players.some((p: any) => p.klass === 'ace_pilot'));
    expect(seen).toBeTruthy();
    // locked once airborne
    const seed = ++seedN; host.c.send(world(seed, 'boarding')); host.c.send(world(seed, 'climb'));
    await new Promise((r) => setTimeout(r, 80));
    host.c.send({ t: 'class', id: null });
    expect((await host.c.wait((m: any) => m.t === 'error')).code).toBe('class_locked');
    host.c.close(); mate.c.close();
  });
  it('the Developer can pick any class without buying it', async () => {
    const dev = await player('DEVELOPER');
    await room(dev);
    for (const k of CLASSES) { dev.c.send({ t: 'class', id: k.id }); expect((await dev.c.wait((m: any) => m.t === 'class')).id).toBe(k.id); }
    dev.c.close();
  });
  it('Admin and Trusted cannot grant credits or items; the site re-checks the actor', async () => {
    const adm = await player('ADMIN'), tr = await player('TRUSTED'), p = await player('PLAYER');
    await room(adm, tr, p);
    expect((await grantWs(adm, p, { credits: 500 })).t).toBe('admin_denied');
    expect((await grantWs(tr, p, { item: 'class:ace_pilot' })).t).toBe('admin_denied');
    expect((await grantWs(p, p, { credits: 500 })).t).toBe('admin_denied');
    const forged = await request(app).post('/api/game/grant').set('x-game-server-key', KEY).send({ actorUserId: adm.id, targetUserId: p.id, credits: 500 });
    expect(forged.status).toBe(403);
    expect(await balanceOf(db, p.id)).toBe(0);
    adm.c.close(); tr.c.close(); p.c.close();
  });
  it('Developer grants and removes items; removing credits never goes below zero (audited)', async () => {
    const dev = await player('DEVELOPER'), p = await player('PLAYER');
    await room(dev, p);
    expect((await grantWs(dev, p, { item: 'class:security' })).t).toBe('admin_ok');
    p.c.send({ t: 'class', id: 'security' }); expect((await p.c.wait((m: any) => m.t === 'class')).id).toBe('security');
    await grantWs(dev, p, { item: 'class:security', remove: true });
    p.c.send({ t: 'class', id: 'security' }); expect((await p.c.wait((m: any) => m.t === 'error')).code).toBe('not_owned');
    await grantWs(dev, p, { credits: 300 }); await grantWs(dev, p, { credits: -5000 });
    expect(await balanceOf(db, p.id)).toBe(0);
    expect((await db('audit_logs').where({ action: 'ingame.wallet.grant', target_id: String(p.id) })).length).toBe(4);
    dev.c.close(); p.c.close();
  });
});
