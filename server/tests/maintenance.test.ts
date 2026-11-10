import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { setup, PW, getCsrf } from './helpers.js';
import { isMaintenance, maintenanceBlocks, clearMaintenanceCache, getMaintenance } from '../src/lib/maintenance.js';

const TOKEN = 'b'.repeat(40);
let env: Awaited<ReturnType<typeof setup>>;
let dev: any, admin: any, player: any;
beforeAll(async () => {
  env = await setup({ backupToken: TOKEN });
  dev = await env.user('DEVELOPER');
  admin = await env.user('ADMIN');
  player = await env.user('PLAYER');
});
afterAll(async () => { await env.close(); });
afterEach(() => { delete process.env.MAINTENANCE_MODE; clearMaintenanceCache(env.db); });

const put = (u: any, body: unknown) => u.agent.put('/api/dev/maintenance').set('x-csrf-token', u.csrf).send(body as object);
const on = (message = 'Upgrading servers', eta: string | null = new Date(Date.now() + 3600e3).toISOString()) => put(dev, { enabled: true, message, eta });
const off = () => put(dev, { enabled: false });

describe('maintenance mode', () => {
  it('only the Developer can toggle it (server-verified, audit-logged)', async () => {
    expect((await put(admin, { enabled: true })).status).toBe(403);
    expect((await put(player, { enabled: true })).status).toBe(403);
    expect((await request(env.app).put('/api/dev/maintenance').send({ enabled: true })).status).toBe(403); // no CSRF / no session
    expect((await admin.agent.get('/api/dev/maintenance')).status).toBe(403);
    const r = await on();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ on: true, enabled: true, forced: false, message: 'Upgrading servers' });
    expect(await isMaintenance(env.db)).toBe(true);
    const u = await put(dev, { enabled: true, message: 'Almost done', eta: '' });
    expect(u.body).toMatchObject({ message: 'Almost done', eta: null });
    expect((await off()).body.on).toBe(false);
    const acts = await env.db('audit_logs').where({ category: 'site' }).pluck('action');
    expect(acts).toEqual(expect.arrayContaining(['maintenance.on', 'maintenance.update', 'maintenance.off']));
    expect((await put(dev, { enabled: true, extra: 1 })).status).toBe(400);
  });

  it('blocks non-Developers: pages show the maintenance page, APIs return 503', async () => {
    await on('Back with new planes', null);
    const anon = request(env.app);
    const home = await anon.get('/');
    expect(home.status).toBe(503);
    expect(home.text).toContain('under maintenance');
    expect(home.headers['retry-after']).toBeTruthy();
    expect((await anon.get('/games/sky-crew')).status).toBe(503);
    expect((await anon.get('/play/sky-crew')).status).toBe(503);
    expect((await anon.get('/api/games')).status).toBe(503);
    expect((await anon.get('/api/games')).body.code).toBe('maintenance');
    // existing non-Developer sessions are blocked
    for (const u of [player, admin]) {
      expect((await u.agent.get('/')).status).toBe(503);
      expect((await u.agent.get('/api/me')).status).toBe(503);
      expect((await u.agent.post('/api/game/token').set('x-csrf-token', u.csrf).send({ game: 'sky-crew' })).status).toBe(503);
      expect((await u.agent.get('/api/admin/users')).status).toBe(503);
    }
    expect((await anon.get('/admin')).status).toBe(503);
    // the maintenance page can load its assets and its status
    expect((await anon.get('/css/site.css')).status).toBe(200);
    expect((await anon.get('/js/maintenance.js')).status).toBe(200);
    const st = await anon.get('/api/maintenance');
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ on: true, message: 'Back with new planes' });
    await off();
    expect((await anon.get('/')).status).toBe(200);
    expect((await player.agent.get('/api/me')).status).toBe(200);
  });

  it('login and register return 503 for non-Developers; the Developer can still sign in', async () => {
    await on();
    const a = request.agent(env.app);
    const csrf = await getCsrf(a);
    expect((await a.get('/login')).status).toBe(200);
    const reg = await a.post('/api/auth/register').set('x-csrf-token', csrf).send({ username: 'newbie_m', password: 'long-enough-password' });
    expect(reg.status).toBe(503);
    expect(await env.db('users').where({ username_lower: 'newbie_m' }).first()).toBeUndefined();
    const lp = await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: player.username, password: PW });
    expect(lp.status).toBe(503);
    expect(lp.body.code).toBe('maintenance');
    // wrong password still says wrong password (no maintenance hint before auth)
    expect((await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: player.username, password: 'nope-nope-nope' })).status).toBe(401);
    const d = request.agent(env.app);
    const dc = await getCsrf(d);
    const ld = await d.post('/api/auth/login').set('x-csrf-token', dc).send({ login: dev.username, password: PW });
    expect(ld.status).toBe(200);
    await off();
  });

  it('the Developer bypasses everything', async () => {
    await on();
    expect((await dev.agent.get('/')).status).toBe(200);
    expect((await dev.agent.get('/api/games')).status).toBe(200);
    expect((await dev.agent.get('/studio-console')).status).toBe(200);
    expect((await dev.agent.post('/api/game/token').set('x-csrf-token', dev.csrf).send({ game: 'sky-crew' })).status).toBe(200);
    expect((await dev.agent.get('/api/maintenance')).body.youCanBypass).toBe(true);
    expect(await maintenanceBlocks(env.db, 'DEVELOPER')).toBe(false);
    expect(await maintenanceBlocks(env.db, 'ADMIN')).toBe(true);
    expect(await maintenanceBlocks(env.db, null)).toBe(true);
    await off();
  });

  it('/healthz and /api/internal/backup keep working', async () => {
    await on();
    const hz = await request(env.app).get('/healthz');
    expect(hz.status).toBe(200);
    expect(hz.body.ok).toBe(true);
    const b = await request(env.app).get('/api/internal/backup').set('authorization', `Bearer ${TOKEN}`);
    expect(b.status).toBe(200);
    expect(b.body.tables).toHaveProperty('site_settings');
    expect((await request(env.app).get('/api/internal/backup').set('authorization', 'Bearer wrong')).status).toBe(401);
    await off();
  });

  it('MAINTENANCE_MODE=true forces it on, even when the dashboard switch is off', async () => {
    await off();
    process.env.MAINTENANCE_MODE = 'true';
    expect(await isMaintenance(env.db)).toBe(true);
    expect((await getMaintenance(env.db)).forced).toBe(true);
    expect((await request(env.app).get('/')).status).toBe(503);
    expect((await player.agent.get('/api/games')).status).toBe(503);
    expect((await dev.agent.get('/api/games')).status).toBe(200);
    const r = await off();
    expect(r.body).toMatchObject({ on: true, forced: true, enabled: false });
    delete process.env.MAINTENANCE_MODE;
    expect(await isMaintenance(env.db)).toBe(false);
    expect((await request(env.app).get('/')).status).toBe(200);
  });

  it('caches reads briefly but a toggle takes effect immediately', async () => {
    expect(await isMaintenance(env.db)).toBe(false);
    await on();
    expect(await isMaintenance(env.db)).toBe(true);
    // a change written behind the cache's back is picked up after the cache expires (here: cleared)
    await env.db('site_settings').where({ key: 'maintenance' }).update({ value: JSON.stringify({ enabled: false }) });
    clearMaintenanceCache(env.db);
    expect(await isMaintenance(env.db)).toBe(false);
  });
});
