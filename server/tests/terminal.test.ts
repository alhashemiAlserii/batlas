import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { migrate, insertId } from '../src/db/index.js';
import { testDb, PW } from './helpers.js';
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
  const id = await insertId(db('users').insert({ username, username_lower: username.toLowerCase(), handle: username, handle_lower: username.toLowerCase(), password_hash: await hashPassword(PW), pin_set: true, role, display_name: username, created_at: new Date().toISOString() }));
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



import { STATIONS, FLOOR_Y } from '../src/game-server/terminal.js';
const F = FLOOR_Y;
const at = (p: any, x: number, y: number, z: number) => { p.c.send({ t: 'st', s: { p: [x, y, z], ry: 0, pt: 0, mode: 'walk' } }); return new Promise((r) => setTimeout(r, 40)); };
const step = async (p: any, s: string) => { p.c.send({ t: 'term', step: s }); return p.c.wait((m: any) => (m.t === 'term' && m.cid === cidOf(p)) || (m.t === 'error' && /^term_/.test(m.code))); };
const tick = (ms = 3000) => { clock += ms; };
/** the full honest walk: desk -> belt/scanner -> gate desk -> cabin */
async function walkThrough(p: any) {
  tick(); await at(p, STATIONS.checkin.x, F, STATIONS.checkin.z); expect((await step(p, 'checkin')).t).toBe('term');
  tick(); await at(p, STATIONS.arch.x, F, STATIONS.arch.z - 1.2); expect((await step(p, 'security')).t).toBe('term');
  tick(); await at(p, STATIONS.gatedesk.x, F, STATIONS.gatedesk.z); expect((await step(p, 'gate')).t).toBe('term');
  tick(); await at(p, 0, 0, 10); expect((await step(p, 'boarded')).t).toBe('term');
}
const world = (seed: number, ph: string, extra: any = {}) => ({ t: 'world', w: { seed, ph, route: 'CRP', px: Array.from({ length: 16 }, (_, i) => [i + 1, 0, 0, 0, 0, 'seated', '', 80, 0, '', '', 1]), res: extra.res ?? null } });
const GOOD = { landedAt: 'CRP', landing: 'good', crashed: false };
let seedN = 900;

describe('pre-flight airport terminal (server-validated steps)', () => {
  it('steps only advance in order, at the right desk, at human speed', async () => {
    const a = await player('PLAYER');
    await room(a);
    a.c.send(world(++seedN, 'boarding')); await new Promise((r) => setTimeout(r, 60));
    tick(); await at(a, STATIONS.gatedesk.x, F, STATIONS.gatedesk.z);
    let e = await step(a, 'gate'); expect(e.code).toBe('term_order'); // forged: skip straight to the gate
    e = await step(a, 'boarded'); expect(e.code).toBe('term_order');
    e = await step(a, 'teleport'); expect(e.code).toBe('term_bad');
    await at(a, 0, F, 59); e = await step(a, 'checkin'); expect(e.code).toBe('term_far'); // not at the desk
    await at(a, STATIONS.checkin.x, F, STATIONS.checkin.z); e = await step(a, 'checkin'); expect(e.t).toBe('term');
    const r = await a.c.wait((m: any) => m.t === 'room' && m.players.some((p: any) => p.term === 'checkin'));
    expect(r.airport).toBe(true);
    await at(a, STATIONS.arch.x, F, STATIONS.arch.z - 1.2); e = await step(a, 'security'); expect(e.code).toBe('term_fast'); // no time for the belt
    tick(); await at(a, STATIONS.arch.x, F, STATIONS.arch.z + 1.5); e = await step(a, 'security'); expect(e.code).toBe('term_far'); // still before the scanner
    await at(a, STATIONS.arch.x, F, STATIONS.arch.z - 1.2); e = await step(a, 'security'); expect(e.t).toBe('term');
    tick(); await at(a, STATIONS.gatedesk.x, F, STATIONS.gatedesk.z); expect((await step(a, 'gate')).t).toBe('term');
    tick(); await at(a, 0, F, 20); e = await step(a, 'boarded'); expect(e.code).toBe('term_far'); // still on the apron
    await at(a, 0, 0, 10); expect((await step(a, 'boarded')).t).toBe('term');
    await new Promise((r) => setTimeout(r, 300));
    const logs = await db('audit_logs').where({ action: 'ingame.terminal.denied' }).count({ n: '*' }).first();
    expect(Number(logs.n)).toBeGreaterThanOrEqual(2);
    a.c.close();
  });
  it('crew who skip the terminal are left off the payslip; a new flight resets everyone', async () => {
    const host = await player('PLAYER'), skip = await player('PLAYER');
    await room(host, skip);
    const seed = ++seedN;
    host.c.send(world(seed, 'boarding'));
    await new Promise((r) => setTimeout(r, 50));
    await walkThrough(host);
    host.c.send(world(seed, 'taxi')); host.c.send(world(seed, 'climb'));
    await new Promise((r) => setTimeout(r, 50));
    tick(200_000);
    host.c.send(world(seed, 'landed')); host.c.send(world(seed, 'results', { res: GOOD }));
    const [a, b] = await Promise.all([host.c.wait((m: any) => m.t === 'salary'), skip.c.wait((m: any) => m.t === 'salary')]);
    expect(a.amount).toBeGreaterThan(0);
    expect(b.amount).toBe(0); expect(b.reason).toMatch(/skipped the airport/);
    // after the flight, the plane is back at the gate (new seed): everyone starts at the entrance again
    host.c.send(world(seed + 1000, 'boarding'));
    const r = await skip.c.wait((m: any) => m.t === 'room' && m.players.every((p: any) => p.term === 'none'));
    expect(r.players.length).toBe(2);
    // and the airport is closed once the plane has left the gate
    host.c.send(world(seed + 1000, 'taxi')); await new Promise((r) => setTimeout(r, 50));
    tick(); await at(skip, STATIONS.checkin.x, F, STATIONS.checkin.z);
    expect((await step(skip, 'checkin')).code).toBe('term_late');
    host.c.close(); skip.c.close();
  });
  it('only the host (or the Developer) can skip the airport; the Developer can teleport past it', async () => {
    const host = await player('PLAYER'), guest = await player('ADMIN'), dev = await player('DEVELOPER');
    await room(host, guest, dev);
    host.c.send(world(++seedN, 'boarding')); await new Promise((r) => setTimeout(r, 60));
    guest.c.send({ t: 'airport', skip: true });
    expect((await guest.c.wait((m: any) => m.t === 'error')).code).toBe('not_host');
    admin(dev, 'teleport', { to: 'cabin' });
    const r = await host.c.wait((m: any) => m.t === 'room' && m.players.find((p: any) => p.cid === cidOf(dev))?.term === 'boarded');
    expect(r.players.find((p: any) => p.cid === cidOf(guest)).term).toBe('none');
    host.c.send({ t: 'airport', skip: true });
    await guest.c.wait((m: any) => m.t === 'room' && m.airport === false);
    tick(); await at(guest, STATIONS.checkin.x, F, STATIONS.checkin.z);
    expect((await step(guest, 'checkin')).code).toBe('term_off');
    await new Promise((r) => setTimeout(r, 300));
    expect(await db('audit_logs').where({ action: 'ingame.terminal.dev_skip' }).first()).toBeTruthy();
    host.c.close(); guest.c.close(); dev.c.close();
  });
});
