import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setup, testDb, getCsrf } from './helpers.js';
import { bootstrapDeveloper } from '../src/lib/bootstrap.js';
import { createApp } from '../src/app.js';

describe('deploy: health check', () => {
  it('GET /healthz answers without a session cookie', async () => {
    const env = await setup();
    const res = await request(env.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    await env.close();
  });
});

describe('deploy: first-boot Developer', () => {
  const PASS = 'bootstrap-pass-12345'; // test fixture for the one-time password, not a PIN and not a real account
  const TEST_SETUP_PIN = '424242'; // test-only PIN
  it('does nothing without the env var', async () => {
    const db = await testDb();
    expect(await bootstrapDeveloper(db, {}, () => {})).toBe('skipped');
    expect(await db('users').count({ n: '*' }).first()).toMatchObject({ n: expect.anything() });
    expect(Number((await db('users').count({ n: '*' }).first())!.n)).toBe(0);
    await db.destroy();
  });
  it('creates Abood without a PIN, then the owner sets one; the secret is not logged', async () => {
    const db = await testDb();
    const logs: string[] = [];
    expect(await bootstrapDeveloper(db, { BOOTSTRAP_DEVELOPER_PASSWORD: PASS }, (m) => logs.push(m))).toBe('created');
    const u = await db('users').where({ username_lower: 'abood' }).first();
    const id = u.id;
    expect(u.role).toBe('DEVELOPER');
    expect(u.username).toBe('Abood');
    expect(u.handle).toBe('Abood');
    expect(u.display_name).toBe('szpab');
    expect(!!u.pin_set).toBe(false);
    expect(u.email).toBeNull();
    expect(logs.join(' ')).not.toContain(PASS);
    expect(await bootstrapDeveloper(db, { BOOTSTRAP_DEVELOPER_PASSWORD: 'another-pass-67890' }, () => {})).toBe('exists');
    expect(Number((await db('users').count({ n: '*' }).first())!.n)).toBe(1);
    const app = createApp(db, { cookieSecure: false, rateLimit: { windowMs: 60000, max: 1000 } }).app;
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const blocked = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'abood', pin: TEST_SETUP_PIN });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('pin_setup_required');
    const setup = await agent.post('/api/auth/pin/setup').set('x-csrf-token', csrf).send({ login: 'Abood', currentPassword: PASS, pin: TEST_SETUP_PIN });
    expect(setup.status).toBe(200);
    expect(setup.body.user.id).toBe(id);
    expect(setup.body.user.handle).toBe('Abood');
    expect(setup.body.user.displayName).toBe('szpab');
    expect(setup.body.user.role).toBe('DEVELOPER');
    expect(JSON.stringify(setup.body)).not.toContain(PASS);
    expect(logs.join(' ')).not.toContain(TEST_SETUP_PIN);
    await db.destroy();
  });
  it('rejects a short password', async () => {
    const db = await testDb();
    expect(await bootstrapDeveloper(db, { BOOTSTRAP_DEVELOPER_PASSWORD: 'short' }, () => {})).toBe('error');
    await db.destroy();
  });
});
