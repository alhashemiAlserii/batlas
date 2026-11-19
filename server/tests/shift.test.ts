import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createShift, unlocksFromHistory, CALLS, INCIDENTS } from '../src/game-server/shift.js';
import { migrate, insertId } from '../src/db/index.js';
import { testDb, PW } from './helpers.js';
import { createApp } from '../src/app.js';
import { attachGameServer, WS_PATH } from '../src/game-server/server.js';
import { httpSiteBridge } from '../src/game-server/bridge.js';
import { hashPassword } from '../src/lib/crypto.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import request from 'supertest';

describe('route ladder', () => {
  it('opens Dune Bay first, then Coral Point, then Pine Ridge', () => {
    expect(unlocksFromHistory([]).open).toEqual(['DNB']);
    expect(unlocksFromHistory([{ route: 'DNB', stars: 1, crashed: false }]).open).toEqual(['DNB']);
    expect(unlocksFromHistory([{ route: 'DNB', stars: 2, crashed: false }]).open).toEqual(['DNB', 'CRP']);
    expect(unlocksFromHistory([{ route: 'DNB', stars: 2, crashed: false }, { route: 'CRP', stars: 3, crashed: false }]).open).toEqual(['DNB', 'CRP', 'PNR']);
  });
  it('keeps a route that is already on the account, and ignores crashes', () => {
    expect(unlocksFromHistory([{ route: 'CRP', stars: 2, crashed: false }]).open).toEqual(['DNB', 'CRP']);
    expect(unlocksFromHistory([{ route: 'CRP', stars: 4, crashed: false }]).open).toEqual(['DNB', 'CRP', 'PNR']);
    expect(unlocksFromHistory([{ route: 'PNR', stars: 5, crashed: true }]).open).toEqual(['DNB']);
    expect(unlocksFromHistory([{ route: 'NOPE', stars: 5, crashed: false }, { route: 'DNB', stars: 9, crashed: false }]).best.DNB).toBe(5);
  });
});

describe('service shift rules', () => {
  function fly(opts: { tutorial?: boolean; route?: string; solo?: boolean; roles?: Record<string, string> } = {}) {
    const shift = createShift({ seed: 7, route: opts.route || 'DNB', tutorial: opts.tutorial, solo: opts.solo !== false, paxIds: [1, 2, 3, 4], roles: opts.roles });
    shift.tick(0, { phase: 'cruise', paxIds: [1, 2, 3, 4], seats: [{ id: 1, x: 1, z: -2 }] });
    return shift;
  }

  it('training hop asks for one drink, then chop, and scores a brace', () => {
    const s = fly({ tutorial: true });
    let drink: any = null;
    for (let i = 0; i < 20 && !drink; i++) {
      const out = s.tick(0.2, { phase: 'cruise' });
      drink = out.spawned.find((e) => (e as any).t === 'call') as any;
    }
    expect(drink.call.kind).toBe('drink');
    expect(drink.call.item).toBe('water');
    expect(s.act('p1', { k: 'resolve', id: drink.call.id, item: 'snack' }).ok).toBe(false);
    const ok = s.act('p1', { k: 'resolve', id: drink.call.id, item: 'water' }, { pos: [1, 0, -2], seat: { x: 1, z: -2 }, reach: 3 });
    expect(ok.ok).toBe(true);
    expect(ok.points).toBeGreaterThan(CALLS.drink.points);
    let chop = false;
    for (let i = 0; i < 30 && !chop; i++) {
      const out = s.tick(0.2, { phase: 'cruise', belt: true });
      const snap = s.snapshot() as { incidents: { kind: string }[] };
      chop = out.spawned.some((e) => (e as any).incident?.kind === 'turbulence') || snap.incidents.some((e) => e.kind === 'turbulence');
    }
    expect(chop).toBe(true);
    for (let i = 0; i < 40; i++) s.tick(0.25, { phase: 'cruise', belt: true });
    const card = s.card();
    expect(card.lines.some(([l]) => /braced/.test(l))).toBe(true);
    expect(card.resolved).toBe(1);
  });

  it('pays the cabin more than the pilot for a meal, and the cargo chief more for a spill', () => {
    const cabin = createShift({ seed: 3, route: 'CRP', solo: false, paxIds: [4], roles: { a: 'cabin' } });
    cabin.tick(0, { phase: 'cruise', seats: [{ id: 4, x: 0, z: 0 }] });
    expect(cabin.act('a', { k: 'resolve', id: 999, item: 'snack' }).ok).toBe(false);
    const meal = cabin.force('meal')!;
    const paid = cabin.act('a', { k: 'resolve', id: meal.id, item: 'snack' }, { pos: [0.2, 0, 0.2], reach: 3 });
    expect(paid.points).toBe(Math.round(CALLS.meal.points * 1.45));

    const pilot = createShift({ seed: 3, route: 'CRP', solo: false, paxIds: [4], roles: { b: 'pilot' } });
    pilot.tick(0, { phase: 'cruise', seats: [{ id: 4, x: 0, z: 0 }] });
    const same = pilot.force('meal')!;
    expect(pilot.act('b', { k: 'resolve', id: same.id, item: 'snack' }, { pos: [0, 0, 0], reach: 3 }).points).toBe(CALLS.meal.points);

    const cargo = createShift({ seed: 11, route: 'PNR', solo: false, paxIds: [1], roles: { c: 'cargo' } });
    cargo.tick(0, { phase: 'cruise' });
    cargo.force('cargo_spill');
    expect(cargo.act('c', { k: 'secure' }, { pos: [0, 0, 4] }).ok).toBe(false);
    expect(cargo.act('c', { k: 'secure' }, { pos: [0, 0, -10] }).points).toBe(Math.round(INCIDENTS.cargo_spill.points * 1.45));
  });

  it('rejects a far-away serve, times out a flare, and grades a crash as zero stars', () => {
    const s = createShift({ seed: 1, route: 'DNB', solo: false, paxIds: [2], roles: { a: 'cabin' } });
    s.tick(0, { phase: 'cruise', seats: [{ id: 2, x: 0, z: 0 }] });
    const drink = s.force('drink')!;
    expect(s.act('a', { k: 'resolve', id: drink.id, item: 'water' }, { pos: [30, 0, 30], reach: 3 }).ok).toBe(false);
    expect(s.act('a', { k: 'resolve', id: drink.id, item: 'water' }, { pos: [1, 0, 0.4], reach: 3 }).ok).toBe(true);
    const cry = s.force('cry')!;
    expect(s.act('a', { k: 'resolve', id: cry.id, item: 'blanket' }).reason).toMatch(/talk/);
    expect(s.act('a', { k: 'resolve', id: cry.id, item: null }, { pos: [0, 0, 0], reach: 3 }).ok).toBe(true);

    const fire = createShift({ seed: 99, route: 'PNR', paxIds: [1], roles: { a: 'cabin' } });
    fire.tick(0, { phase: 'cruise' });
    fire.force('galley_fire');
    expect(fire.act('a', { k: 'extinguish' }, { pos: [0, 0, 0] }).ok).toBe(false);
    for (let i = 0; i < 130; i++) fire.tick(0.25, { phase: 'cruise' });
    expect(fire.card().incidentsFailed).toBe(1);
    expect(fire.card().lines.some(([l]) => /got away/.test(l))).toBe(true);

    const med = createShift({ seed: 5, route: 'CRP', solo: false, paxIds: [8], roles: { a: 'cabin' } });
    med.tick(0, { phase: 'cruise', seats: [{ id: 8, x: 0, z: 1 }] });
    med.force('medical');
    const sick = (med.snapshot() as { calls: { id: number; kind: string; item: string | null }[] }).calls.find((c) => c.kind === 'sick')!;
    expect(sick.item).toBe('water');
    const healed = med.act('a', { k: 'resolve', id: sick.id, item: 'water' }, { pos: [0, 0, 1], reach: 3 });
    expect(healed.ok).toBe(true);
    expect(med.card().incidentsHandled).toBe(1);

    const dead = createShift({ seed: 4, route: 'CRP', solo: true, paxIds: [1] });
    dead.act('solo', { k: 'land', grade: 'crash', crashed: true, arrived: false });
    expect(dead.finish().stars).toBe(0);
    expect(dead.finish().crashed).toBe(true);
  });

  it('scores bags, seating and a butter landing, and will not depart twice', () => {
    const s = createShift({ seed: 2, route: 'DNB', solo: true, paxIds: [1, 2] });
    expect(s.act('solo', { k: 'depart', bags: 4, seated: 8, checklist: true }).ok).toBe(true);
    expect(s.act('solo', { k: 'depart', bags: 4, seated: 8, checklist: true }).ok).toBe(false);
    s.tick(0, { phase: 'approach' });
    s.act('solo', { k: 'land', grade: 'butter', crashed: false, arrived: true }, { role: 'pilot' });
    const card = s.finish();
    expect(card.points).toBeGreaterThan(200);
    expect(card.stars).toBeGreaterThanOrEqual(1);
    expect(card.arrived).toBe(true);
    expect(card.lines.map(([l]) => l).join(' ')).toMatch(/Bags stowed/);
  });
});

describe('co-op shift is server-owned', () => {
  let server: http.Server, port: number, db: any, gs: ReturnType<typeof attachGameServer>, app: any;
  beforeAll(async () => {
    db = await testDb();
    await migrate(db);
    app = createApp(db, { cookieSecure: false, gameServerKey: 'shift-key', rateLimit: { windowMs: 60000, max: 1000 } }, { mailer: new MemoryMailer() }).app;
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as any).port;
    gs = attachGameServer(server, { bridge: httpSiteBridge(`http://127.0.0.1:${port}`, 'shift-key'), log: () => {} });
  });
  afterAll(async () => { gs.close(); await new Promise((r) => server.close(r)); await db.destroy(); });

  async function player(name: string) {
    const id = await insertId(db('users').insert({ username: name, username_lower: name, handle: name, handle_lower: name, password_hash: await hashPassword(PW), pin_set: true, role: 'PLAYER', display_name: name, created_at: new Date().toISOString() }));
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/csrf')).body.csrfToken;
    const login = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: name, password: PW });
    const c2 = (([] as string[]).concat(login.headers['set-cookie'] as any).find((s) => s.startsWith('csrf=')) ?? '').split(';')[0].slice(5) || csrf;
    const t = await agent.post('/api/game/token').set('x-csrf-token', decodeURIComponent(c2)).send({ game: 'sky-crew' });
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    ws.send(JSON.stringify({ t: 'auth', token: t.body.token }));
    const welcome = await wait((m) => m.t === 'welcome');
    return { id, ws, welcome, send: (m: any) => ws.send(JSON.stringify(m)), wait };
    function wait(f: (m: any) => boolean, ms = 4000) {
      const hit = msgs.find(f);
      if (hit) { msgs.splice(msgs.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise<any>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('timeout')), ms);
        const iv = setInterval(() => {
          const i = msgs.findIndex(f);
          if (i >= 0) { clearInterval(iv); clearTimeout(timer); res(msgs.splice(i, 1)[0]); }
        }, 20);
      });
    }
  }

  it('two players share one scored drink call', async () => {
    const a = await player('shift_host');
    const b = await player('shift_guest');
    a.send({ t: 'create' });
    const room = await a.wait((m) => m.t === 'room' && m.you);
    b.send({ t: 'join', code: room.code });
    await b.wait((m) => m.t === 'room' && m.you);
    a.send({ t: 'crew', role: 'pilot' });
    b.send({ t: 'crew', role: 'cabin' });
    const px = [1, 0.2, 0, -1, 0, 'seated', '', 80, 0, '', '', 1];
    a.send({ t: 'world', w: { seed: 42, ph: 'cruise', route: 'DNB', tut: 1, px: [px], counts: { loaded: 4, boarded: 8 }, cabin: { seatbelt: false }, full: { sc: {} } } });
    const shift = await b.wait((m) => m.t === 'shift' && m.s?.calls?.length, 5000);
    const call = shift.s.calls[0];
    expect(call.kind).toBe('drink');
    b.send({ t: 'st', s: { p: [0.2, 0, -1], ry: 0, mode: 'walk' } });
    b.send({ t: 'duty', a: { k: 'resolve', id: call.id, item: 'snack' } });
    expect((await b.wait((m) => m.t === 'error' && m.code === 'duty')).message).toMatch(/water/);
    b.send({ t: 'duty', a: { k: 'resolve', id: call.id, item: 'water' } });
    const scored = await a.wait((m) => m.t === 'shift' && m.ack?.ok);
    expect(scored.ack.cid).toBe(b.welcome.you.cid);
    expect(scored.ack.points).toBeGreaterThan(0);
    expect(scored.s.resolved).toBe(1);
    expect(scored.s.calls.find((c: any) => c.id === call.id)).toBeUndefined();
    a.ws.close(); b.ws.close();
  });
});

describe('shared module', () => {
  it('ships the same shift rules to the browser and the server', () => {
    const a = fs.readFileSync(new URL('../src/game-server/shift.js', import.meta.url), 'utf8');
    const b = fs.readFileSync(new URL('../../web/public/play/sky-crew/js/shift.js', import.meta.url), 'utf8');
    expect(a).toBe(b);
  });
});
