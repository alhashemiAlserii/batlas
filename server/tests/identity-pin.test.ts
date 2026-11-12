import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { hashPassword } from '../src/lib/crypto.js';
import { insertId } from '../src/db/index.js';
import * as m001 from '../src/db/migrations/001_init.js';
import * as m002 from '../src/db/migrations/002_stage2.js';
import * as m003 from '../src/db/migrations/003_optional_email.js';
import * as m004 from '../src/db/migrations/004_game_flights.js';
import * as m005 from '../src/db/migrations/005_website.js';
import * as m006 from '../src/db/migrations/006_sky_crew_outfits.js';
import * as m007 from '../src/db/migrations/007_sky_crew_economy.js';
import * as m008 from '../src/db/migrations/008_handle_pin.js';
import { setup, testDb, getCsrf, cookieCsrf, PW } from './helpers.js';

/** Test-only PINs. Not real account secrets. */
const NEW_PIN = '424242';
const BAD_PIN = '999991';

describe('migration: usernames become handles, abood becomes Abood / szpab, no PIN is invented', () => {
  it('keeps ids and password hashes, defaults a blank display name, and renames only the Developer abood', async () => {
    const db = await testDb({ migrate: false });
    for (const m of [m001, m002, m003, m004, m005, m006, m007]) await m.up(db);
    const legacyHash = 'legacy-hash-not-a-pin';
    const devId = await insertId(db('users').insert({
      username: 'abood', username_lower: 'abood', password_hash: legacyHash, role: 'DEVELOPER', display_name: null, created_at: new Date().toISOString(),
    }));
    const blankId = await insertId(db('users').insert({
      username: 'Pal', username_lower: 'pal', password_hash: 'x', role: 'PLAYER', display_name: '', created_at: new Date().toISOString(),
    }));
    const namedId = await insertId(db('users').insert({
      username: 'ace', username_lower: 'ace', password_hash: 'x', role: 'PLAYER', display_name: 'Ace Pilot', created_at: new Date().toISOString(),
    }));
    await m008.up(db);

    const dev = await db('users').where({ id: devId }).first();
    expect(dev.role).toBe('DEVELOPER');
    expect(dev.username).toBe('Abood');
    expect(dev.handle).toBe('Abood');
    expect(dev.handle_lower).toBe('abood');
    expect(dev.display_name).toBe('szpab');
    expect(dev.password_hash).toBe(legacyHash);
    expect(!!dev.pin_set).toBe(false);

    const pal = await db('users').where({ id: blankId }).first();
    expect(pal.handle).toBe('Pal');
    expect(pal.username).toBe('Pal');
    expect(pal.display_name).toBe('Pal');
    expect(!!pal.pin_set).toBe(false);

    const ace = await db('users').where({ id: namedId }).first();
    expect(ace.handle).toBe('ace');
    expect(ace.display_name).toBe('Ace Pilot');
    await db.destroy();
  });
});

describe('handle, display name and PIN', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { env = await setup({ rateLimit: { windowMs: 60000, max: 1000 } }); });
  afterAll(async () => { await env.close(); });

  async function anon() {
    const agent = request.agent(env.app);
    return { agent, csrf: await getCsrf(agent) };
  }

  it('registers with a handle and PIN only (no email), stores the handle casing, and signs in case-insensitively', async () => {
    const a = await anon();
    const reg = await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ handle: 'Pilot_Zed', displayName: 'Sky Kid', pin: PW });
    expect(reg.status).toBe(201);
    expect(reg.body.user.email).toBe('');
    expect(reg.body.user.handle).toBe('Pilot_Zed');
    expect(reg.body.user.username).toBe('Pilot_Zed');
    expect(reg.body.user.displayName).toBe('Sky Kid');
    expect(reg.body.user.role).toBe('PLAYER');
    expect(reg.body.user).not.toHaveProperty('password_hash');
    const row = await env.db('users').where({ handle_lower: 'pilot_zed' }).first();
    expect(row.pin_set).toBeTruthy();
    expect(row.password_hash).not.toBe(PW);

    const b = await anon();
    const login = await b.agent.post('/api/auth/login').set('x-csrf-token', b.csrf).send({ login: 'pilot_zed', pin: PW });
    expect(login.status).toBe(200);
    expect(login.body.user.handle).toBe('Pilot_Zed');
    expect(login.body.user.displayName).toBe('Sky Kid');
    const stranger = await anon();
    expect((await stranger.agent.post('/api/auth/login').set('x-csrf-token', stranger.csrf).send({ login: 'kid@mail.test', pin: PW })).status).toBe(401);
  });

  it('rejects a duplicate handle regardless of case, and rejects a non-PIN', async () => {
    const a = await anon();
    expect((await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ handle: 'pilot_zed', pin: PW })).status).toBe(409);
    expect((await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ username: 'FreshKid', password: 'not-a-pin' })).status).toBe(400);
    expect((await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ handle: 'ab', pin: PW })).status).toBe(400);
  });

  it('shows the display name to other people, including the leaderboard and game verify', async () => {
    const owner = await anon();
    const login = await owner.agent.post('/api/auth/login').set('x-csrf-token', owner.csrf).send({ login: 'Pilot_Zed', pin: PW });
    expect(login.status).toBe(200);
    const csrf = cookieCsrf(login) ?? owner.csrf;
    const pub = await request(env.app).get('/api/users/PILOT_ZED');
    expect(pub.status).toBe(200);
    expect(pub.body.user.displayName).toBe('Sky Kid');
    expect(pub.body.user.handle).toBe('Pilot_Zed');
    expect(pub.body.user).not.toHaveProperty('email');

    const flight = await owner.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', csrf).send({ score: 900, stars: 3, landing: 'butter', route: 'CRP', crashed: false, duration: 80 });
    expect(flight.status).toBeLessThan(300);
    const board = await request(env.app).get('/api/games/sky-crew/leaderboard');
    const row = board.body.leaderboard.find((r: { handle: string }) => r.handle === 'Pilot_Zed');
    expect(row.displayName).toBe('Sky Kid');

    const token = (await owner.agent.post('/api/game/token').set('x-csrf-token', csrf).send({})).body.token;
    const verified = await request(env.app).post('/api/game/verify').set('x-game-server-key', 'test-game-server-key-123').send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.user.displayName).toBe('Sky Kid');
    expect(verified.body.user.handle).toBe('Pilot_Zed');
    expect(verified.body.user).not.toHaveProperty('email');
  });

  it('lets the player change their display name from settings, and the server rejects a bad one', async () => {
    const a = await anon();
    const login = await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'pilot_zed', pin: PW });
    const csrf = cookieCsrf(login) ?? a.csrf;
    expect((await a.agent.patch('/api/me').set('x-csrf-token', csrf).send({ displayName: 'Kid <script>', role: 'DEVELOPER' })).status).toBe(400);
    const ok = await a.agent.patch('/api/me').set('x-csrf-token', csrf).send({ displayName: 'Captain Zed' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.displayName).toBe('Captain Zed');
    expect(ok.body.user.role).toBe('PLAYER');
    expect(ok.body.user.handle).toBe('Pilot_Zed');
    expect((await request(env.app).get('/api/users/pilot_zed')).body.user.displayName).toBe('Captain Zed');
  });

  it('changes a handle only when it is unique, and the user id stays the same', async () => {
    const a = await anon();
    const login = await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'pilot_zed', pin: PW });
    const csrf = cookieCsrf(login) ?? a.csrf;
    const before = login.body.user.id;
    const other = await anon();
    expect((await other.agent.post('/api/auth/register').set('x-csrf-token', other.csrf).send({ handle: 'TakenName', pin: PW })).status).toBe(201);
    expect((await a.agent.patch('/api/me/handle').set('x-csrf-token', csrf).send({ handle: 'takenname', pin: PW })).status).toBe(409);
    const changed = await a.agent.patch('/api/me/handle').set('x-csrf-token', csrf).send({ handle: 'Pilot_Zed2', pin: BAD_PIN });
    expect(changed.status).toBe(403);
    const ok = await a.agent.patch('/api/me/handle').set('x-csrf-token', csrf).send({ handle: 'Pilot_Zed2', pin: PW });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(before);
    expect(ok.body.user.handle).toBe('Pilot_Zed2');
    expect(ok.body.user.role).toBe('PLAYER');
    expect((await request(env.app).get('/api/users/pilot_zed')).status).toBe(404);
    expect((await request(env.app).get('/api/users/PILOT_ZED2')).body.user.displayName).toBe('Captain Zed');
  });

  it('locks an account after repeated wrong PINs, locks an IP from the stored counter, and does not log the PIN', async () => {
    const a = await anon();
    const reg = await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ handle: 'lock_me', pin: PW });
    expect(reg.status).toBe(201);
    const csrf = cookieCsrf(reg) ?? a.csrf;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await a.agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'lock_me', pin: BAD_PIN })).status);
    expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(codes[4]).toBe(429);
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'lock_me', pin: PW })).status).toBe(429);

    const logs = await env.db('audit_logs').where({ action: 'auth.login_failed', target_label: 'lock_me' });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(BAD_PIN);

    await env.db('auth_lockouts').where({ scope: 'account' }).delete();
    const ip = await env.db('auth_lockouts').where({ scope: 'ip' }).first();
    expect(ip).toBeTruthy();
    await env.db('auth_lockouts').where({ scope: 'ip', subject: ip.subject }).update({ failures: 15, locked_until: new Date(Date.now() + 60_000).toISOString() });
    const net = await a.agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'lock_me', pin: PW });
    expect(net.status).toBe(429);
    expect(net.body.error).toMatch(/network/);
    await env.db('auth_lockouts').where({ scope: 'ip', subject: ip.subject }).delete();
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'lock_me', pin: PW })).status).toBe(200);
  });

  it('migrates a password account through the setup flow without logging the old password or the new PIN', async () => {
    const legacy = 'legacy-password-ok';
    const id = await insertId(env.db('users').insert({
      username: 'old_pal', username_lower: 'old_pal', handle: 'old_pal', handle_lower: 'old_pal',
      password_hash: await hashPassword(legacy), pin_set: false, role: 'PLAYER', display_name: 'Old Pal', created_at: new Date().toISOString(),
    }));
    const a = await anon();
    const blocked = await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'OLD_PAL', pin: PW });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('pin_setup_required');
    expect((await a.agent.post('/api/auth/pin/setup').set('x-csrf-token', a.csrf).send({ login: 'old_pal', currentPassword: 'nope-nope-nope', pin: NEW_PIN })).status).toBe(401);
    const setup = await a.agent.post('/api/auth/pin/setup').set('x-csrf-token', a.csrf).send({ login: 'old_pal', currentPassword: legacy, pin: NEW_PIN });
    expect(setup.status).toBe(200);
    expect(setup.body.user.id).toBe(id);
    expect(setup.body.user.displayName).toBe('Old Pal');
    expect(JSON.stringify(setup.body)).not.toContain(legacy);
    expect(JSON.stringify(setup.body)).not.toContain(NEW_PIN);
    const audits = await env.db('audit_logs').where({ target_id: String(id) });
    const text = JSON.stringify(audits);
    expect(text).not.toContain(legacy);
    expect(text).not.toContain(NEW_PIN);
    const b = await anon();
    expect((await b.agent.post('/api/auth/login').set('x-csrf-token', b.csrf).send({ login: 'old_pal', pin: PW })).status).toBe(401);
    expect((await b.agent.post('/api/auth/login').set('x-csrf-token', b.csrf).send({ login: 'old_pal', pin: NEW_PIN })).status).toBe(200);
  });

  it('lets staff reset a PIN, refuses to reset or demote or ban the Developer, and still checks permissions on the server', async () => {
    const dev = await env.user('DEVELOPER', 'Abood');
    await env.db('users').where({ id: dev.id }).update({ display_name: 'szpab', handle: 'Abood', handle_lower: 'abood', username: 'Abood', username_lower: 'abood' });
    const admin = await env.user('ADMIN');
    const player = await env.user('PLAYER', 'needs_pin');
    const devRow = await env.db('users').where({ id: dev.id }).first();
    expect(devRow.display_name).toBe('szpab');
    expect(devRow.handle).toBe('Abood');

    expect((await admin.agent.post(`/api/admin/users/${dev.id}/ban`).set('x-csrf-token', admin.csrf).send({ reason: 'nope' })).status).toBe(403);
    expect((await admin.agent.put(`/api/admin/users/${dev.id}/role`).set('x-csrf-token', admin.csrf).send({ role: 'PLAYER' })).status).toBe(403);
    expect((await admin.agent.post(`/api/admin/users/${dev.id}/reset-pin`).set('x-csrf-token', admin.csrf).send({})).status).toBe(403);
    expect((await env.db('users').where({ id: dev.id }).first()).role).toBe('DEVELOPER');
    expect(!!(await env.db('users').where({ id: dev.id }).first()).banned).toBe(false);

    // Changing the display name does not move the protection off the user id.
    await env.db('users').where({ id: dev.id }).update({ display_name: 'Not Szpab' });
    expect((await admin.agent.post(`/api/admin/users/${dev.id}/kick`).set('x-csrf-token', admin.csrf).send({ reason: 'x' })).status).toBe(403);
    await env.db('users').where({ id: dev.id }).update({ display_name: 'szpab' });

    expect((await player.agent.get('/api/admin/users')).status).toBe(403);
    const reset = await admin.agent.post(`/api/admin/users/${player.id}/reset-pin`).set('x-csrf-token', admin.csrf).send({});
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPin).toMatch(/^\d{6}$/);
    const temp = reset.body.temporaryPin as string;
    const audit = await env.db('audit_logs').where({ action: 'player.password_reset', target_id: String(player.id) }).first();
    expect(JSON.stringify(audit)).not.toContain(temp);

    const a = await anon();
    const login = await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'needs_pin', pin: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePin).toBe(true);
    const csrf = cookieCsrf(login) ?? a.csrf;
    expect((await a.agent.patch('/api/me').set('x-csrf-token', csrf).send({ displayName: 'Nope' })).status).toBe(403);
    const changed = await a.agent.post('/api/me/pin').set('x-csrf-token', csrf).send({ currentPin: temp, newPin: NEW_PIN });
    expect(changed.status).toBe(200);
    const csrf2 = cookieCsrf(changed) ?? csrf;
    expect((await a.agent.patch('/api/me').set('x-csrf-token', csrf2).send({ displayName: 'Needs Pin' })).status).toBe(200);
  });
});
