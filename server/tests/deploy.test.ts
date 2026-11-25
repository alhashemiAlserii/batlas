import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setup, testDb, getCsrf } from './helpers.js';
import { bootstrapDeveloper } from '../src/lib/bootstrap.js';
import { createApp } from '../src/app.js';
import { parsePublicBaseUrl } from '../src/config.js';

describe('deploy: health check', () => {
  it('GET /healthz answers without a session cookie', async () => {
    const env = await setup();
    const res = await request(env.app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['set-cookie']).toBeUndefined();
    await env.close();
  });

  it('lets a Cloudflare Pages origin read /healthz and refuses everyone else', async () => {
    const env = await setup();
    const ok = await request(env.app).get('/healthz').set('Origin', 'https://batlas-szpab.pages.dev');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect(ok.headers['access-control-allow-origin']).toBe('https://batlas-szpab.pages.dev');
    expect(ok.headers['access-control-allow-methods']).toContain('GET');
    expect(ok.headers['vary']).toContain('Origin');
    expect(ok.headers['set-cookie']).toBeUndefined();

    const preview = await request(env.app).get('/healthz').set('Origin', 'https://abc123.batlas-szpab.pages.dev');
    expect(preview.status).toBe(200);
    expect(preview.headers['access-control-allow-origin']).toBe('https://abc123.batlas-szpab.pages.dev');

    const preflight = await request(env.app).options('/healthz').set('Origin', 'https://batlas-szpab.pages.dev');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://batlas-szpab.pages.dev');
    expect(preflight.headers['set-cookie']).toBeUndefined();

    for (const origin of ['https://evil.example', 'http://batlas-szpab.pages.dev', 'https://pages.dev.evil.com', 'https://notpages.dev', 'https://batlas-szpab.pages.dev.evil.com']) {
      const denied = await request(env.app).get('/healthz').set('Origin', origin);
      expect(denied.status).toBe(200);
      expect(denied.body).toEqual({ ok: true });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    }
    await env.close();
  });
});

describe('public front door', () => {
  it('parses PUBLIC_BASE_URL down to an origin', () => {
    expect(parsePublicBaseUrl(undefined)).toBeNull();
    expect(parsePublicBaseUrl('')).toBeNull();
    expect(parsePublicBaseUrl('   ')).toBeNull();
    expect(parsePublicBaseUrl('not a url')).toBeNull();
    expect(parsePublicBaseUrl('javascript:alert(1)')).toBeNull();
    expect(parsePublicBaseUrl('https://user:secret@batlas-szpab.pages.dev/play')).toBeNull();
    expect(parsePublicBaseUrl('https://batlas-szpab.pages.dev/play/sky-crew?room=ABCDE#x')).toBe('https://batlas-szpab.pages.dev');
    expect(parsePublicBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
  });

  it('omits a share origin until PUBLIC_BASE_URL is set', async () => {
    const off = await setup();
    const plain = await request(off.app).get('/api/site');
    expect(plain.status).toBe(200);
    expect(plain.body.studioName).toBeTruthy();
    expect(plain.body.publicBaseUrl).toBeNull();
    await off.close();

    const on = await setup({ publicBaseUrl: 'https://batlas-szpab.pages.dev' });
    const site = await request(on.app).get('/api/site');
    expect(site.body.publicBaseUrl).toBe('https://batlas-szpab.pages.dev');
    expect(site.body).toHaveProperty('emailEnabled');
    await on.close();
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
