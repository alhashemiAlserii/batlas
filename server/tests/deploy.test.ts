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
  const PASS = 'bootstrap-pass-12345';
  it('does nothing without the env var', async () => {
    const db = await testDb();
    expect(await bootstrapDeveloper(db, {}, () => {})).toBe('skipped');
    expect(await db('users').count({ n: '*' }).first()).toMatchObject({ n: expect.anything() });
    expect(Number((await db('users').count({ n: '*' }).first())!.n)).toBe(0);
    await db.destroy();
  });
  it('creates abood once (must change password), then ignores the variable', async () => {
    const db = await testDb();
    const logs: string[] = [];
    expect(await bootstrapDeveloper(db, { BOOTSTRAP_DEVELOPER_PASSWORD: PASS }, (m) => logs.push(m))).toBe('created');
    const u = await db('users').where({ username_lower: 'abood' }).first();
    expect(u.role).toBe('DEVELOPER');
    expect(!!u.must_change_password).toBe(true);
    expect(u.email).toBeNull();
    expect(logs.join(' ')).not.toContain(PASS);
    expect(await bootstrapDeveloper(db, { BOOTSTRAP_DEVELOPER_PASSWORD: 'another-pass-67890' }, () => {})).toBe('exists');
    expect(Number((await db('users').count({ n: '*' }).first())!.n)).toBe(1);
    // can sign in with it, and is then asked to pick a new password
    const app = createApp(db, { cookieSecure: false, rateLimit: { windowMs: 60000, max: 1000 } }).app;
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'abood', password: PASS });
    expect(res.status).toBe(200);
    await db.destroy();
  });
  it('rejects a short password', async () => {
    const db = await testDb();
    expect(await bootstrapDeveloper(db, { BOOTSTRAP_DEVELOPER_PASSWORD: 'short' }, () => {})).toBe('error');
    await db.destroy();
  });
});
