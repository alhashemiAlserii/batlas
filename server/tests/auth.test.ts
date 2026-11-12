import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup, getCsrf, cookieCsrf, PW } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe('auth', () => {
  it('register -> me -> logout -> me is null -> login', async () => {
    const a = request.agent(env.app);
    let csrf = await getCsrf(a);
    const reg = await a.post('/api/auth/register').set('x-csrf-token', csrf).send({ username: 'pilot_one', email: 'p1@x.com', password: PW });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('PLAYER');
    expect(reg.body.user).not.toHaveProperty('password_hash');
    const sc = ([] as string[]).concat(reg.headers['set-cookie'] as any);
    const sid = sc.find((c) => c.startsWith('sid='))!;
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    csrf = cookieCsrf(reg) ?? csrf;

    const me = await a.get('/api/me');
    expect(me.body.user.username).toBe('pilot_one');

    const out = await a.post('/api/auth/logout').set('x-csrf-token', csrf);
    expect(out.status).toBe(200);
    expect((await a.get('/api/me')).body.user).toBeNull();

    const login = await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'PiLoT_oNe', pin: PW });
    expect(login.status).toBe(200);
    expect((await a.get('/api/me')).body.user.handle).toBe('pilot_one');
    const csrf2 = cookieCsrf(login) ?? csrf;
    expect((await a.post('/api/auth/login').set('x-csrf-token', csrf2).send({ login: 'p1@x.com', pin: PW })).status).toBe(401);
  });

  it('rejects wrong password and duplicate accounts', async () => {
    const a = request.agent(env.app);
    const csrf = await getCsrf(a);
    expect((await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'pilot_one', password: 'wrong-password!!' })).status).toBe(401);
    expect((await a.post('/api/auth/register').set('x-csrf-token', csrf).send({ username: 'PILOT_ONE', email: 'other@x.com', password: PW })).status).toBe(409);
  });

  it('validates input with zod', async () => {
    const a = request.agent(env.app);
    const csrf = await getCsrf(a);
    const r = await a.post('/api/auth/register').set('x-csrf-token', csrf).send({ username: 'a b', email: 'nope', password: 'short' });
    expect(r.status).toBe(400);
  });

  it('ignores a role in the register body', async () => {
    const a = request.agent(env.app);
    const csrf = await getCsrf(a);
    const r = await a.post('/api/auth/register').set('x-csrf-token', csrf).send({ username: 'sneaky', email: 'sneaky@x.com', password: PW, role: 'DEVELOPER', banned: false });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('PLAYER');
    const row = await env.db('users').where({ username_lower: 'sneaky' }).first();
    expect(row.role).toBe('PLAYER');
    const perms = await a.get('/api/me/permissions');
    expect(perms.body.permissions).toEqual([]);
  });

  it('cannot change own role via profile edit', async () => {
    const p = await env.user('PLAYER');
    const r = await p.agent.patch('/api/me').set('x-csrf-token', p.csrf).send({ role: 'DEVELOPER' });
    expect(r.status).toBe(400);
    const ok = await p.agent.patch('/api/me').set('x-csrf-token', p.csrf).send({ displayName: 'Captain', bio: 'hi' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.displayName).toBe('Captain');
    expect(ok.body.user.role).toBe('PLAYER');
  });

  it('requires a session for protected endpoints', async () => {
    const a = request.agent(env.app);
    const csrf = await getCsrf(a);
    expect((await a.patch('/api/me').set('x-csrf-token', csrf).send({ bio: 'x' })).status).toBe(401);
    expect((await a.get('/api/admin/users')).status).toBe(401);
    expect((await a.post('/api/game/weather').set('x-csrf-token', csrf).send({ weather: 'rain' })).status).toBe(401);
    expect((await a.post('/api/game/token').set('x-csrf-token', csrf).send({})).status).toBe(401);
  });

  it('a forged session cookie is ignored', async () => {
    const r = await request(env.app).get('/api/me').set('Cookie', 'sid=forged-token-value');
    expect(r.body.user).toBeNull();
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const p = await env.user('PLAYER');
    const r = await p.agent.patch('/api/me').send({ bio: 'x' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('csrf');
    const r2 = await p.agent.patch('/api/me').set('x-csrf-token', 'wrong').send({ bio: 'x' });
    expect(r2.status).toBe(403);
  });

  it('public profile hides email', async () => {
    const r = await request(env.app).get('/api/users/pilot_one');
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('PLAYER');
    expect(r.body.user).not.toHaveProperty('email');
  });

  it('sets security headers (helmet)', async () => {
    const r = await request(env.app).get('/api/health');
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('blocks repeated login attempts', async () => {
    const e = await setup({ rateLimit: { windowMs: 60000, max: 3 } });
    const a = request.agent(e.app);
    const csrf = await getCsrf(a);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await a.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'nobody', password: 'whatever-123' })).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes[3]).toBe(429);
    await e.close();
  });
});
