import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup, getCsrf, cookieCsrf, PW } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any, dev2: any, admin: any, admin2: any, trusted: any, player: any;
beforeAll(async () => {
  env = await setup(); // default config: email features OFF
  dev = await env.user('DEVELOPER');
  dev2 = await env.user('DEVELOPER');
  admin = await env.user('ADMIN');
  admin2 = await env.user('ADMIN');
  trusted = await env.user('TRUSTED');
  player = await env.user('PLAYER');
});
afterAll(async () => { await env.close(); });
const send = (u: any, url: string, body: object = {}) => u.agent.post(url).set('x-csrf-token', u.csrf).send(body);
async function anon() { const a = request.agent(env.app); return { agent: a, csrf: await getCsrf(a) }; }

describe('email is optional', () => {
  it('register with username + password only, then log in by username', async () => {
    const a = await anon();
    const r = await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ username: 'ipad_kid', password: PW });
    expect(r.status).toBe(201);
    expect(r.body.user.email).toBe('');
    expect(r.body.user.role).toBe('PLAYER');
    const a2 = await anon();
    const r2 = await a2.agent.post('/api/auth/register').set('x-csrf-token', a2.csrf).send({ username: 'ipad_kid2', email: '', password: PW });
    expect(r2.status).toBe(201);
    expect(env.mailer.sent).toHaveLength(0); // no verification mail
    const b = await anon();
    expect((await b.agent.post('/api/auth/login').set('x-csrf-token', b.csrf).send({ login: 'IPAD_KID', password: PW })).status).toBe(200);
    const a3 = await anon();
    expect((await a3.agent.post('/api/auth/register').set('x-csrf-token', a3.csrf).send({ username: 'bad_mail', email: 'not-an-email', password: PW })).status).toBe(400);
  });

  it('a player can add, change and remove an optional email (needs current password)', async () => {
    const a = await anon();
    const r = await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ username: 'mail_later', password: PW });
    const csrf = cookieCsrf(r) ?? a.csrf;
    expect((await a.agent.post('/api/me/email').set('x-csrf-token', csrf).send({ email: 'later@x.co', currentPassword: 'wrong-pass-1' })).status).toBe(403);
    const ok = await a.agent.post('/api/me/email').set('x-csrf-token', csrf).send({ email: 'later@x.co', currentPassword: PW });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('later@x.co');
    expect((await a.agent.post('/api/me/email').set('x-csrf-token', csrf).send({ email: '', currentPassword: PW })).body.user.email).toBe('');
  });

  it('email endpoints are switched off by default', async () => {
    const a = await anon();
    expect((await a.agent.post('/api/auth/password/forgot').set('x-csrf-token', a.csrf).send({ email: 'x@y.co' })).status).toBe(404);
    expect((await a.agent.post('/api/auth/password/reset').set('x-csrf-token', a.csrf).send({ token: 'x'.repeat(30), password: PW })).status).toBe(404);
    expect((await a.agent.post('/api/auth/verify-email/confirm').set('x-csrf-token', a.csrf).send({ token: 'x'.repeat(30) })).status).toBe(404);
  });

  it('contact form works without an email', async () => {
    const a = await anon();
    expect((await a.agent.post('/api/contact').set('x-csrf-token', a.csrf).send({ name: 'Kid', subject: 'Hi', message: 'I love the game!!' })).status).toBe(201);
    expect((await a.agent.post('/api/contact').set('x-csrf-token', a.csrf).send({ name: 'Kid', email: 'nope', subject: 'Hi', message: 'I love the game!!' })).status).toBe(400);
  });
});

describe('staff password reset (temporary password)', () => {
  it('players and trusted cannot reset passwords', async () => {
    expect((await send(player, `/api/admin/users/${trusted.id}/temp-password`)).status).toBe(403);
    expect((await send(trusted, `/api/admin/users/${player.id}/temp-password`)).status).toBe(403);
  });

  it('admins cannot reset Developers or other Admins; Developers cannot reset Developers', async () => {
    expect((await send(admin, `/api/admin/users/${dev.id}/temp-password`)).status).toBe(403);
    expect((await send(admin, `/api/admin/users/${admin2.id}/temp-password`)).status).toBe(403);
    expect((await send(dev, `/api/admin/users/${dev2.id}/temp-password`)).status).toBe(403);
    expect((await send(dev, `/api/admin/users/${dev.id}/temp-password`)).status).toBe(403);
    // Developer password unchanged: still logs in
    const a = await anon();
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: dev.username, password: PW })).status).toBe(200);
  });

  it('admin resets a player: sessions revoked, temp works once-off, forced change enforced server-side, audited', async () => {
    const victim = await env.user('PLAYER', 'forgot_it');
    const r = await send(admin, `/api/admin/users/${victim.id}/temp-password`);
    expect(r.status).toBe(200);
    const temp = r.body.temporaryPassword as string;
    expect(temp).toMatch(/^\d{6}$/);
    expect((await victim.agent.get('/api/me')).body.user).toBeNull(); // signed out
    const a = await anon();
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'forgot_it', password: PW })).status).toBe(401);
    const login = await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'forgot_it', password: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const csrf = cookieCsrf(login) ?? a.csrf;
    // blocked until password changed
    expect((await a.agent.patch('/api/me').set('x-csrf-token', csrf).send({ bio: 'x' })).status).toBe(403);
    expect((await a.agent.post('/api/game/token').set('x-csrf-token', csrf).send({})).status).toBe(403);
    expect((await a.agent.get('/api/games')).status).toBe(200); // public reads still fine
    expect((await a.agent.get('/api/me')).body.user.mustChangePassword).toBe(true);
    // choose a new password
    const ch = await a.agent.post('/api/me/pin').set('x-csrf-token', csrf).send({ currentPin: temp, newPin: '424242' });
    expect(ch.status, JSON.stringify(ch.body)).toBe(200);
    expect((await a.agent.get('/api/me')).body.user.mustChangePassword).toBe(false);
    const csrf2 = cookieCsrf(ch) ?? csrf; // new session => new CSRF token
    expect((await a.agent.patch('/api/me').set('x-csrf-token', csrf2).send({ bio: 'ok' })).status).toBe(200);
    // temp password no longer works
    const b = await anon();
    expect((await b.agent.post('/api/auth/login').set('x-csrf-token', b.csrf).send({ login: 'forgot_it', password: temp })).status).toBe(401);
    // audit entry without the password
    const log = await env.db('audit_logs').where({ action: 'player.password_reset', target_label: 'forgot_it' }).first();
    expect(log.actor_id).toBe(admin.id);
    expect(JSON.stringify(log)).not.toContain(temp);
    const denied = await env.db('audit_logs').where({ action: 'player.password_reset.denied', actor_id: admin.id }).first();
    expect(denied).toBeTruthy();
  });

  it('Developer can reset an Admin', async () => {
    const a = await env.user('ADMIN', 'lost_admin');
    expect((await send(dev, `/api/admin/users/${a.id}/temp-password`)).status).toBe(200);
  });
});
