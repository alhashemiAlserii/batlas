import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup, getCsrf, PW } from './helpers.js';
import { canActOn, permissionsFor, PERMISSIONS } from '../src/lib/permissions.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any, dev2: any, admin: any, admin2: any, trusted: any, player: any, player2: any;
beforeAll(async () => {
  env = await setup();
  dev = await env.user('DEVELOPER', 'Owner');
  dev2 = await env.user('DEVELOPER', 'CoOwner');
  admin = await env.user('ADMIN');
  admin2 = await env.user('ADMIN');
  trusted = await env.user('TRUSTED');
  player = await env.user('PLAYER');
  player2 = await env.user('PLAYER');
});
afterAll(async () => { await env.close(); });

const post = (u: any, url: string, body: object = {}) => u.agent.post(url).set('x-csrf-token', u.csrf).send(body);
const put = (u: any, url: string, body: object = {}) => u.agent.put(url).set('x-csrf-token', u.csrf).send(body);

describe('permission map', () => {
  it('/api/me/permissions returns the correct set per rank', async () => {
    const get = async (u: any) => (await u.agent.get('/api/me/permissions')).body;
    const p = await get(player);
    expect(p).toEqual({ role: 'PLAYER', permissions: [] });
    const t = await get(trusted);
    expect(t.permissions).toEqual(['admin.panel', 'items.spawn.approved']);
    const a = await get(admin);
    expect(a.permissions.sort()).toEqual(['admin.commands', 'admin.panel', 'emergency.manage', 'emergency.trigger', 'items.spawn.approved', 'moderation.view', 'players.ban', 'players.kick', 'players.reset_password', 'players.view', 'weather.change'].sort());
    for (const forbidden of ['items.spawn.any', 'items.spawn.developer', 'roles.grant.developer', 'roles.grant.admin', 'dev.menu', 'games.manage', 'audit.view']) {
      expect(a.permissions).not.toContain(forbidden);
    }
    const d = await get(dev);
    expect(d.permissions.sort()).toEqual([...PERMISSIONS].sort());
    const anon = (await request(env.app).get('/api/me/permissions')).body;
    expect(anon).toEqual({ role: null, permissions: [] });
  });

  it('canActOn protects the Developer and enforces hierarchy', () => {
    expect(canActOn({ id: 1, role: 'ADMIN' }, { id: 2, role: 'DEVELOPER' }).ok).toBe(false);
    expect(canActOn({ id: 1, role: 'DEVELOPER' }, { id: 2, role: 'DEVELOPER' }).ok).toBe(false);
    expect(canActOn({ id: 1, role: 'DEVELOPER' }, { id: 1, role: 'DEVELOPER' }).ok).toBe(false);
    expect(canActOn({ id: 1, role: 'ADMIN' }, { id: 2, role: 'ADMIN' }).ok).toBe(false);
    expect(canActOn({ id: 1, role: 'ADMIN' }, { id: 2, role: 'TRUSTED' }).ok).toBe(true);
    expect(canActOn({ id: 1, role: 'ADMIN' }, { id: 2, role: 'PLAYER' }).ok).toBe(true);
    expect(canActOn({ id: 1, role: 'DEVELOPER' }, { id: 2, role: 'ADMIN' }).ok).toBe(true);
    expect(permissionsFor('DEVELOPER').length).toBe(PERMISSIONS.length);
  });
});

describe('players are blocked from admin endpoints', () => {
  it('player gets 403 everywhere', async () => {
    expect((await player.agent.get('/api/admin/users')).status).toBe(403);
    expect((await player.agent.get('/api/admin/moderation')).status).toBe(403);
    expect((await player.agent.get('/api/admin/audit')).status).toBe(403);
    expect((await post(player, `/api/admin/users/${player2.id}/ban`)).status).toBe(403);
    expect((await post(player, `/api/admin/users/${player2.id}/kick`)).status).toBe(403);
    expect((await put(player, `/api/admin/users/${player.id}/role`, { role: 'ADMIN' })).status).toBe(403);
    expect((await post(player, '/api/game/weather', { weather: 'storm' })).status).toBe(403);
    expect((await post(player, '/api/game/emergency', { scenario: 'turbulence' })).status).toBe(403);
    expect((await post(player, '/api/game/spawn', { item: 'suitcase' })).status).toBe(403);
    expect((await player.agent.get('/api/dev/games')).status).toBe(403);
  });
  it('player cannot load the admin or developer pages', async () => {
    expect((await player.agent.get('/admin')).status).toBe(403);
    expect((await player.agent.get('/admin/app.js')).status).toBe(404);
    expect((await player.agent.get('/studio-console')).status).toBe(404);
    expect((await player.agent.get('/studio-console/app.js')).status).toBe(404);
    expect((await request(env.app).get('/studio-console')).status).toBe(404);
    expect((await request(env.app).get('/admin')).status).toBe(302);
    expect((await request(env.app).get('/console.html')).status).toBe(404);
  });
});

describe('trusted', () => {
  it('can spawn approved items only', async () => {
    expect((await post(trusted, '/api/game/spawn', { item: 'snack_cart' })).status).toBe(200);
    expect((await post(trusted, '/api/game/spawn', { item: 'plasma_cannon', tier: 'developer' })).status).toBe(403);
    expect((await post(trusted, '/api/game/spawn', { item: 'anything', tier: 'any' })).status).toBe(403);
  });
  it('cannot ban, kick, change weather or trigger emergencies', async () => {
    expect((await post(trusted, `/api/admin/users/${player.id}/ban`)).status).toBe(403);
    expect((await post(trusted, `/api/admin/users/${player.id}/kick`)).status).toBe(403);
    expect((await post(trusted, '/api/game/weather', { weather: 'rain' })).status).toBe(403);
    expect((await post(trusted, '/api/game/emergency', { scenario: 'engine_failure' })).status).toBe(403);
    expect((await put(trusted, `/api/admin/users/${player.id}/role`, { role: 'TRUSTED' })).status).toBe(403);
    expect((await trusted.agent.get('/api/admin/users')).status).toBe(403);
    expect((await trusted.agent.get('/studio-console')).status).toBe(404);
    expect((await trusted.agent.get('/admin')).status).toBe(200);
  });
});

describe('admin', () => {
  it('can use admin game controls but not developer ones', async () => {
    expect((await post(admin, '/api/game/weather', { weather: 'storm' })).status).toBe(200);
    expect((await post(admin, '/api/game/emergency', { scenario: 'cabin_pressure' })).status).toBe(200);
    expect((await post(admin, '/api/game/emergency', { scenario: 'cabin_pressure', action: 'stop' })).status).toBe(200);
    expect((await post(admin, '/api/game/spawn', { item: 'suitcase' })).status).toBe(200);
    expect((await post(admin, '/api/game/spawn', { item: 'plasma_cannon', tier: 'developer' })).status).toBe(403);
    expect((await post(admin, '/api/game/teleport', { to: 'cockpit' })).status).toBe(403);
    expect((await post(admin, '/api/game/npc', {})).status).toBe(403);
    expect((await admin.agent.get('/api/dev/games')).status).toBe(403);
    expect((await admin.agent.get('/api/admin/audit')).status).toBe(403);
    expect((await admin.agent.get('/studio-console')).status).toBe(404);
  });

  it('cannot ban, kick, unban or demote the Developer', async () => {
    const ban = await post(admin, `/api/admin/users/${dev.id}/ban`, { reason: 'coup' });
    expect(ban.status).toBe(403);
    expect(ban.body.code).toBe('protected');
    expect((await post(admin, `/api/admin/users/${dev.id}/kick`)).status).toBe(403);
    expect((await post(admin, `/api/admin/users/${dev.id}/unban`)).status).toBe(403);
    expect((await put(admin, `/api/admin/users/${dev.id}/role`, { role: 'PLAYER' })).status).toBe(403);
    const row = await env.db('users').where({ id: dev.id }).first();
    expect(row.role).toBe('DEVELOPER');
    expect(!!row.banned).toBe(false);
    // denied attempt is audit-logged
    const denied = await env.db('audit_logs').where({ action: 'player.ban.denied', actor_id: admin.id }).first();
    expect(denied).toBeTruthy();
    // Developer session still works
    expect((await dev.agent.get('/api/me')).body.user.role).toBe('DEVELOPER');
  });

  it('cannot grant Developer (or any role)', async () => {
    expect((await put(admin, `/api/admin/users/${player.id}/role`, { role: 'DEVELOPER' })).status).toBe(403);
    expect((await put(admin, `/api/admin/users/${admin.id}/role`, { role: 'DEVELOPER' })).status).toBe(403);
    expect((await put(admin, `/api/admin/users/${player.id}/role`, { role: 'ADMIN' })).status).toBe(403);
    expect((await put(admin, `/api/admin/users/${player.id}/role`, { role: 'TRUSTED' })).status).toBe(403);
    expect((await env.db('users').where({ id: admin.id }).first()).role).toBe('ADMIN');
    expect((await env.db('users').where({ id: player.id }).first()).role).toBe('PLAYER');
  });

  it('cannot ban another Admin', async () => {
    expect((await post(admin, `/api/admin/users/${admin2.id}/ban`)).status).toBe(403);
  });

  it('can kick and ban a player; banned player is logged out and cannot log in; audit entries exist', async () => {
    const victim = await env.user('PLAYER', 'rowdy_passenger');
    expect((await post(admin, `/api/admin/users/${victim.id}/kick`, { reason: 'spam' })).status).toBe(200);
    const ban = await post(admin, `/api/admin/users/${victim.id}/ban`, { reason: 'griefing' });
    expect(ban.status).toBe(200);
    expect(ban.body.user.banned).toBe(true);
    // existing session revoked
    expect((await victim.agent.get('/api/me')).body.user).toBeNull();
    // cannot log in
    const a = request.agent(env.app);
    const csrf = await getCsrf(a);
    const login = await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'rowdy_passenger', password: PW });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('banned');

    const mod = await admin.agent.get('/api/admin/moderation');
    expect(mod.status).toBe(200);
    const actions = mod.body.entries.filter((e: any) => e.target === 'rowdy_passenger').map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['player.kick', 'player.ban']));
    const banEntry = mod.body.entries.find((e: any) => e.action === 'player.ban' && e.target === 'rowdy_passenger');
    expect(banEntry.actor).toBe(admin.username);
    expect(banEntry.details.reason).toBe('griefing');
    expect(banEntry.createdAt).toBeTruthy();

    // unban -> can log in again
    expect((await post(admin, `/api/admin/users/${victim.id}/unban`)).status).toBe(200);
    expect((await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'rowdy_passenger', password: PW })).status).toBe(200);
  });

  it('can search users', async () => {
    const r = await admin.agent.get('/api/admin/users?q=rowdy');
    expect(r.status).toBe(200);
    expect(r.body.users.map((u: any) => u.username)).toEqual(['rowdy_passenger']);
  });
});

describe('developer', () => {
  it('can grant and revoke Admin and Trusted; changes are audited', async () => {
    const u = await env.user('PLAYER', 'future_admin');
    expect((await put(dev, `/api/admin/users/${u.id}/role`, { role: 'TRUSTED' })).status).toBe(200);
    expect((await u.agent.get('/api/me/permissions')).body.role).toBe('TRUSTED');
    expect((await put(dev, `/api/admin/users/${u.id}/role`, { role: 'ADMIN' })).status).toBe(200);
    expect((await u.agent.get('/api/me/permissions')).body.permissions).toContain('players.ban');
    expect((await put(dev, `/api/admin/users/${u.id}/role`, { role: 'PLAYER' })).status).toBe(200);
    expect((await u.agent.get('/api/me/permissions')).body.permissions).toEqual([]);
    const logs = await env.db('audit_logs').where({ action: 'role.change', target_label: 'future_admin' }).orderBy('id');
    expect(logs.map((l: any) => JSON.parse(l.details).to)).toEqual(['TRUSTED', 'ADMIN', 'PLAYER']);
    expect(logs.every((l: any) => l.actor_id === dev.id)).toBe(true);
  });

  it('can grant Developer only after re-entering password', async () => {
    const u = await env.user('PLAYER', 'heir');
    expect((await put(dev, `/api/admin/users/${u.id}/role`, { role: 'DEVELOPER' })).status).toBe(403);
    expect((await put(dev, `/api/admin/users/${u.id}/role`, { role: 'DEVELOPER', confirmPassword: 'wrong-one' })).status).toBe(403);
    expect((await put(dev, `/api/admin/users/${u.id}/role`, { role: 'DEVELOPER', confirmPassword: PW })).status).toBe(200);
    expect((await env.db('users').where({ id: u.id }).first()).role).toBe('DEVELOPER');
  });

  it('cannot ban, kick or demote another Developer through the API', async () => {
    expect((await post(dev, `/api/admin/users/${dev2.id}/ban`)).status).toBe(403);
    expect((await post(dev, `/api/admin/users/${dev2.id}/kick`)).status).toBe(403);
    expect((await put(dev, `/api/admin/users/${dev2.id}/role`, { role: 'ADMIN' })).status).toBe(403);
    expect((await put(dev, `/api/admin/users/${dev.id}/role`, { role: 'PLAYER' })).status).toBe(403);
  });

  it('can ban an Admin and use every game control', async () => {
    const rogue = await env.user('ADMIN', 'rogue_admin');
    expect((await post(dev, `/api/admin/users/${rogue.id}/ban`)).status).toBe(200);
    expect((await post(dev, '/api/game/spawn', { item: 'plasma_cannon', tier: 'developer' })).status).toBe(200);
    expect((await post(dev, '/api/game/spawn', { item: 'anything', tier: 'any' })).status).toBe(200);
    expect((await post(dev, '/api/game/teleport', { to: 'wing' })).status).toBe(200);
    expect((await post(dev, '/api/game/npc', { action: 'dance' })).status).toBe(200);
    expect((await post(dev, '/api/game/dev-command', { cmd: 'godmode' })).status).toBe(200);
    expect((await dev.agent.get('/api/admin/audit')).status).toBe(200);
    expect((await dev.agent.get('/studio-console')).status).toBe(200);
    expect((await dev.agent.get('/studio-console/app.js')).status).toBe(200);
  });

  it('every admin game action is audit-logged with actor, action, timestamp and details', async () => {
    const r = await dev.agent.get('/api/admin/audit?category=game');
    const actions = r.body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['game.weather.change', 'game.emergency.start', 'game.emergency.stop', 'game.spawn', 'game.spawn.denied', 'game.teleport', 'game.npc', 'game.dev-command']));
    const w = r.body.entries.find((e: any) => e.action === 'game.weather.change');
    expect(w.actor).toBe(admin.username);
    expect(w.details.weather).toBe('storm');
    expect(new Date(w.createdAt).toString()).not.toBe('Invalid Date');
  });
});

describe('game server token verification', () => {
  it('issues a token to a session and verifies it only with the server key', async () => {
    const t = await post(trusted, '/api/game/token', { game: 'sky-crew' });
    expect(t.status).toBe(200);
    const token = t.body.token;
    expect((await request(env.app).post('/api/game/verify').send({ token })).status).toBe(401);
    expect((await request(env.app).post('/api/game/verify').set('x-game-server-key', 'nope').send({ token })).status).toBe(401);
    const v = await request(env.app).post('/api/game/verify').set('x-game-server-key', 'test-game-server-key-123').send({ token });
    expect(v.status).toBe(200);
    expect(v.body.role).toBe('TRUSTED');
    expect(v.body.permissions).toEqual(['admin.panel', 'items.spawn.approved']);
    // the token itself authorises game calls, still permission-checked
    expect((await request(env.app).post('/api/game/spawn').set('Authorization', `Bearer ${token}`).send({ item: 'tray' })).status).toBe(200);
    expect((await request(env.app).post('/api/game/weather').set('Authorization', `Bearer ${token}`).send({ weather: 'fog' })).status).toBe(403);
    // a game token can't mint more tokens
    expect((await request(env.app).post('/api/game/token').set('Authorization', `Bearer ${token}`).send({})).status).toBe(403);
  });
});
