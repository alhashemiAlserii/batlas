import crypto from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { setup, getCsrf, PW } from './helpers.js';
import { verifyPassword } from '../src/lib/crypto.js';

/** Secrets are created at runtime so no PIN or setup token is stored in the repo. */
const runtimeSecret = () => crypto.randomBytes(32).toString('base64url');
const runtimePin = () => {
  let pin = '';
  do { pin = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0'); } while (pin === PW);
  return pin;
};

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env | null = null;
afterEach(async () => { await env?.close(); env = null; });

async function postBootstrap(app: Env['app'], body: Record<string, string>, csrf?: string) {
  const agent = request.agent(app);
  const token = csrf ?? await getCsrf(agent);
  return agent.post('/api/auth/developer-pin/bootstrap').set('x-csrf-token', token).send(body);
}

describe('developer PIN bootstrap', () => {
  it('is 404 for the page and the API when the env token is missing or blank', async () => {
    const off = await setup();
    try {
      expect((await request(off.app).get('/setup-developer-pin')).status).toBe(404);
      expect((await postBootstrap(off.app, { token: runtimeSecret(), pin: runtimePin(), pinConfirm: runtimePin() })).status).toBe(404);
    } finally { await off.close(); }
    env = await setup({ developerPinBootstrapToken: '   ' });
    expect((await request(env.app).get('/setup-developer-pin')).status).toBe(404);
    expect((await postBootstrap(env.app, { token: runtimeSecret(), pin: runtimePin(), pinConfirm: runtimePin() })).status).toBe(404);
    const html = await request(env.app).get('/login');
    expect(html.text).not.toContain('/setup-developer-pin');
  });

  it('rejects a wrong token without changing any hash, then sets only the Developer once', async () => {
    const token = runtimeSecret();
    const pin = runtimePin();
    const otherPin = runtimePin();
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    try {
      env = await setup({ developerPinBootstrapToken: token, rateLimit: { windowMs: 60_000, max: 20 } });
      const dev = await env.user('DEVELOPER', 'Abood');
      await env.db('users').where({ id: dev.id }).update({ display_name: 'szpab', pin_set: false });
      const player = await env.user('PLAYER', 'school_pal');
      const beforeDev = await env.db('users').where({ id: dev.id }).first();
      const beforePlayer = await env.db('users').where({ id: player.id }).first();
      expect(await env.db('sessions').where({ user_id: dev.id }).first()).toBeTruthy();

      const page = await request(env.app).get('/setup-developer-pin');
      expect(page.status).toBe(200);
      expect(page.text).toContain('id="bootstrap-token"');
      expect(page.text).toContain('Setup token');
      expect(page.text).toContain('id="pin"');
      expect(page.text).toContain('New 4–6 digit PIN');
      expect(page.text).toContain('id="pin-confirm"');
      expect(page.text).toContain('Confirm PIN');
      expect(page.text).toContain('autocomplete="new-password"');
      expect(page.headers['cache-control']).toBe('no-store');

      const wrong = await postBootstrap(env.app, { token: runtimeSecret(), pin, pinConfirm: pin });
      expect(wrong.status).toBe(401);
      expect(JSON.stringify(wrong.body)).not.toContain(token);
      expect(JSON.stringify(wrong.body)).not.toContain(pin);
      const still = await env.db('users').where({ id: dev.id }).first();
      expect(still.password_hash).toBe(beforeDev.password_hash);
      expect(!!still.pin_set).toBe(false);
      expect((await env.db('users').where({ id: player.id }).first()).password_hash).toBe(beforePlayer.password_hash);

      const mismatch = await postBootstrap(env.app, { token, pin, pinConfirm: otherPin });
      expect(mismatch.status).toBe(400);
      expect((await env.db('users').where({ id: dev.id }).first()).password_hash).toBe(beforeDev.password_hash);

      const ok = await postBootstrap(env.app, { token, pin, pinConfirm: pin });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ ok: true });
      expect(JSON.stringify(ok.body)).not.toContain(pin);
      expect(JSON.stringify(ok.body)).not.toContain(token);

      const after = await env.db('users').where({ id: dev.id }).first();
      expect(after.id).toBe(dev.id);
      expect(after.role).toBe('DEVELOPER');
      expect(after.handle).toBe('Abood');
      expect(after.display_name).toBe('szpab');
      expect(!!after.pin_set).toBe(true);
      expect(after.password_hash).not.toBe(beforeDev.password_hash);
      expect(await verifyPassword(after.password_hash, pin)).toBe(true);
      expect(await verifyPassword(after.password_hash, PW)).toBe(false);
      expect(await env.db('sessions').where({ user_id: dev.id }).first()).toBeUndefined();
      expect(await env.db('game_tokens').where({ user_id: dev.id }).first()).toBeUndefined();
      const playerAfter = await env.db('users').where({ id: player.id }).first();
      expect(playerAfter.password_hash).toBe(beforePlayer.password_hash);
      expect(playerAfter.role).toBe('PLAYER');

      const again = await postBootstrap(env.app, { token, pin: otherPin, pinConfirm: otherPin });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('already_used');
      const frozen = await env.db('users').where({ id: dev.id }).first();
      expect(frozen.password_hash).toBe(after.password_hash);
      expect(await verifyPassword(frozen.password_hash, otherPin)).toBe(false);
      const agent = request.agent(env.app);
      const csrf = await getCsrf(agent);
      expect((await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'Abood', pin: PW })).status).toBe(401);
      const logged = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'abood', pin });
      expect(logged.status).toBe(200);
      expect(logged.body.user.id).toBe(dev.id);
      expect(logged.body.user.displayName).toBe('szpab');
      expect(logged.body.user.handle).toBe('Abood');

      const text = JSON.stringify(await env.db('audit_logs').select('*')) + '\n' + logs.join('\n');
      expect(text).not.toContain(pin);
      expect(text).not.toContain(otherPin);
      expect(text).not.toContain(token);
      expect(await env.db('audit_logs').where({ action: 'auth.developer_pin_bootstrap', target_id: String(dev.id) }).first()).toBeTruthy();
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
  });

  it('rate-limits failed attempts', async () => {
    const token = runtimeSecret();
    env = await setup({ developerPinBootstrapToken: token, rateLimit: { windowMs: 60_000, max: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await postBootstrap(env.app, { token: runtimeSecret(), pin: runtimePin(), pinConfirm: runtimePin() })).status);
    expect(codes.slice(0, 2)).toEqual([401, 401]);
    expect(codes[2]).toBe(429);
  });
});
