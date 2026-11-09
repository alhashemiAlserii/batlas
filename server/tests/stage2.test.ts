import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { setup, getCsrf, cookieCsrf, PW } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any, admin: any, trusted: any, player: any;
beforeAll(async () => {
  env = await setup({ emailEnabled: true }); // email features are opt-in (EMAIL_ENABLED=true)
  dev = await env.user('DEVELOPER');
  admin = await env.user('ADMIN');
  trusted = await env.user('TRUSTED');
  player = await env.user('PLAYER');
});
afterAll(async () => { await env.close(); });

const send = (u: any, method: 'post' | 'patch' | 'put' | 'delete', url: string, body: object = {}) => u.agent[method](url).set('x-csrf-token', u.csrf).send(body);
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1];
async function anon() { const a = request.agent(env.app); return { agent: a, csrf: await getCsrf(a) }; }
async function register(name: string) {
  const a = await anon();
  const r = await a.agent.post('/api/auth/register').set('x-csrf-token', a.csrf).send({ username: name, email: `${name}@mail.test`, password: PW });
  expect(r.status).toBe(201);
  return { ...a, csrf: cookieCsrf(r) ?? a.csrf, id: r.body.user.id, email: `${name}@mail.test` };
}

describe('news / announcements', () => {
  it('only news.manage (Developer by default) can manage posts', async () => {
    const body = { slug: 'hello', title: 'Hello' };
    for (const u of [player, trusted, admin]) {
      expect((await send(u, 'post', '/api/dev/news', body)).status).toBe(403);
      expect((await u.agent.get('/api/dev/news')).status).toBe(403);
    }
    expect((await request(env.app).get('/api/dev/news')).status).toBe(401);
    expect((await admin.agent.get('/api/me/permissions')).body.permissions).not.toContain('news.manage');
    expect((await dev.agent.get('/api/me/permissions')).body.permissions).toContain('news.manage');
  });

  it('create draft -> hidden; publish -> visible; pin -> first; unpublish -> hidden; all audited', async () => {
    const a = await send(dev, 'post', '/api/dev/news', { slug: 'first-post', title: 'First post', summary: 'Sum', body: 'Hello world' });
    expect(a.status).toBe(201);
    expect(a.body.post.status).toBe('draft');
    expect((await request(env.app).get('/api/news/first-post')).status).toBe(404);
    const b = await send(dev, 'post', '/api/dev/news', { slug: 'second-post', title: 'Second', status: 'published' });
    expect(b.status).toBe(201);
    expect((await send(dev, 'post', `/api/dev/news/${a.body.post.id}/status`, { status: 'published' })).status).toBe(200);
    let list = (await request(env.app).get('/api/news')).body.posts.map((p: any) => p.slug);
    expect(list).toEqual(expect.arrayContaining(['first-post', 'second-post']));
    expect((await send(dev, 'post', `/api/dev/news/${a.body.post.id}/pin`, { pinned: true })).status).toBe(200);
    list = (await request(env.app).get('/api/news')).body.posts.map((p: any) => p.slug);
    expect(list[0]).toBe('first-post');
    const one = (await request(env.app).get('/api/news/first-post')).body.post;
    expect(one.body).toBe('Hello world');
    expect(one.author.username).toBe(dev.username);
    expect(one.author).not.toHaveProperty('email');
    expect((await send(dev, 'patch', `/api/dev/news/${a.body.post.id}`, { title: 'First post (edited)' })).body.post.title).toBe('First post (edited)');
    expect((await send(dev, 'post', `/api/dev/news/${b.body.post.id}/status`, { status: 'draft' })).status).toBe(200);
    expect((await request(env.app).get('/api/news/second-post')).status).toBe(404);
    expect((await send(admin, 'post', `/api/dev/news/${a.body.post.id}/status`, { status: 'draft' })).status).toBe(403);
    const actions = await env.db('audit_logs').where({ category: 'news' }).pluck('action');
    expect(actions).toEqual(expect.arrayContaining(['news.create', 'news.publish', 'news.pin', 'news.update', 'news.unpublish']));
  });
});

describe('contact form + inbox', () => {
  it('validates, stores, and honeypot silently drops bots', async () => {
    const a = await anon();
    expect((await a.agent.post('/api/contact').set('x-csrf-token', a.csrf).send({ name: '', email: 'bad', subject: '', message: 'short' })).status).toBe(400);
    expect((await a.agent.post('/api/contact').send({ name: 'A', email: 'a@b.co', subject: 'S', message: 'Hello there team!' })).status).toBe(403); // CSRF
    const ok = await a.agent.post('/api/contact').set('x-csrf-token', a.csrf).send({ name: 'Sara', email: 'sara@example.com', subject: 'Partnership', message: 'Hello, I would like to talk.' });
    expect(ok.status).toBe(201);
    const bot = await a.agent.post('/api/contact').set('x-csrf-token', a.csrf).send({ name: 'Bot', email: 'bot@spam.co', subject: 'Buy', message: 'Cheap stuff here!!!', website: 'http://spam' });
    expect(bot.status).toBe(201);
    const rows = await env.db('contact_messages').pluck('name');
    expect(rows).toContain('Sara');
    expect(rows).not.toContain('Bot');
  });

  it('inbox is Developer-only; mark read / archive', async () => {
    for (const u of [player, trusted, admin]) expect((await u.agent.get('/api/dev/inbox')).status).toBe(403);
    const inbox = await dev.agent.get('/api/dev/inbox');
    expect(inbox.status).toBe(200);
    const m = inbox.body.messages.find((x: any) => x.name === 'Sara');
    expect(m.status).toBe('new');
    expect((await send(admin, 'patch', `/api/dev/inbox/${m.id}`, { status: 'read' })).status).toBe(403);
    expect((await send(dev, 'patch', `/api/dev/inbox/${m.id}`, { status: 'read' })).status).toBe(200);
    expect((await dev.agent.get('/api/dev/inbox?status=read')).body.messages.map((x: any) => x.id)).toContain(m.id);
    expect((await send(dev, 'patch', `/api/dev/inbox/${m.id}`, { status: 'archived' })).status).toBe(200);
    expect((await dev.agent.get('/api/dev/inbox')).body.messages.map((x: any) => x.id)).not.toContain(m.id);
    expect((await dev.agent.get('/api/dev/inbox?status=archived')).body.messages.map((x: any) => x.id)).toContain(m.id);
  });

  it('is rate limited', async () => {
    const e = await setup({ contactRateLimit: { windowMs: 60000, max: 2 } });
    const a = request.agent(e.app);
    const csrf = await getCsrf(a);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await a.post('/api/contact').set('x-csrf-token', csrf).send({ name: 'N', email: 'n@x.co', subject: 'S', message: 'Hello hello hello' })).status);
    expect(codes).toEqual([201, 201, 429]);
    await e.close();
  });
});

describe('email verification', () => {
  it('register sends a verification email (outbox) and the token is single-use', async () => {
    const u = await register('verify_me');
    const mail = env.mailer.last(u.email)!;
    expect(mail.subject).toMatch(/Confirm/);
    expect(mail.text).toContain('http://test.local/verify-email?token=');
    const token = tokenFrom(mail.text);
    // only the hash is stored
    expect(await env.db('auth_tokens').where({ token_hash: token }).first()).toBeUndefined();
    expect((await u.agent.get('/api/me')).body.user.emailVerified).toBe(false);
    expect((await u.agent.post('/api/auth/verify-email/confirm').set('x-csrf-token', u.csrf).send({ token })).status).toBe(200);
    expect((await u.agent.get('/api/me')).body.user.emailVerified).toBe(true);
    expect((await u.agent.post('/api/auth/verify-email/confirm').set('x-csrf-token', u.csrf).send({ token })).status).toBe(400);
  });

  it('expired verification tokens are rejected; requesting a new one revokes the old', async () => {
    const u = await register('verify_late');
    const t1 = tokenFrom(env.mailer.last(u.email)!.text);
    expect((await u.agent.post('/api/auth/verify-email/request').set('x-csrf-token', u.csrf).send({})).status).toBe(200);
    const t2 = tokenFrom(env.mailer.last(u.email)!.text);
    expect(t2).not.toBe(t1);
    expect((await u.agent.post('/api/auth/verify-email/confirm').set('x-csrf-token', u.csrf).send({ token: t1 })).status).toBe(400);
    await env.db('auth_tokens').where({ user_id: u.id, purpose: 'verify_email' }).whereNull('used_at').update({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await u.agent.post('/api/auth/verify-email/confirm').set('x-csrf-token', u.csrf).send({ token: t2 })).status).toBe(400);
    expect((await u.agent.get('/api/me')).body.user.emailVerified).toBe(false);
    expect((await request(env.app).post('/api/auth/verify-email/request').set('x-csrf-token', 'x').send({})).status).toBe(403);
  });
});

describe('password reset', () => {
  it('does not reveal whether an email exists', async () => {
    const a = await anon();
    const before = env.mailer.sent.length;
    const r1 = await a.agent.post('/api/auth/password/forgot').set('x-csrf-token', a.csrf).send({ email: 'nobody@nowhere.test' });
    expect(r1.status).toBe(200);
    expect(env.mailer.sent.length).toBe(before);
  });

  it('reset works once, logs out all sessions, and old password stops working', async () => {
    const u = await register('forgetful');
    const other = await anon();
    await other.agent.post('/api/auth/login').set('x-csrf-token', other.csrf).send({ login: 'forgetful', password: PW });
    expect((await other.agent.get('/api/me')).body.user).not.toBeNull();
    const a = await anon();
    expect((await a.agent.post('/api/auth/password/forgot').set('x-csrf-token', a.csrf).send({ email: u.email })).status).toBe(200);
    const mail = env.mailer.last(u.email)!;
    expect(mail.subject).toMatch(/Reset/);
    const token = tokenFrom(mail.text);
    expect((await a.agent.post('/api/auth/password/reset').set('x-csrf-token', a.csrf).send({ token, password: 'short' })).status).toBe(400);
    expect((await a.agent.post('/api/auth/password/reset').set('x-csrf-token', a.csrf).send({ token, password: 'brand-new-password-1' })).status).toBe(200);
    expect((await a.agent.post('/api/auth/password/reset').set('x-csrf-token', a.csrf).send({ token, password: 'another-password-22' })).status).toBe(400); // single use
    expect((await u.agent.get('/api/me')).body.user).toBeNull();
    expect((await other.agent.get('/api/me')).body.user).toBeNull();
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'forgetful', password: PW })).status).toBe(401);
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'forgetful', password: 'brand-new-password-1' })).status).toBe(200);
  });

  it('expired reset tokens are rejected', async () => {
    const u = await register('slowpoke');
    const a = await anon();
    await a.agent.post('/api/auth/password/forgot').set('x-csrf-token', a.csrf).send({ email: u.email });
    const token = tokenFrom(env.mailer.last(u.email)!.text);
    await env.db('auth_tokens').where({ user_id: u.id, purpose: 'reset_password' }).update({ expires_at: new Date(Date.now() - 1).toISOString() });
    expect((await a.agent.post('/api/auth/password/reset').set('x-csrf-token', a.csrf).send({ token, password: 'brand-new-password-1' })).status).toBe(400);
  });

  it('a verification token cannot be used as a reset token', async () => {
    const u = await register('mixup');
    const token = tokenFrom(env.mailer.last(u.email)!.text); // verify_email token
    const a = await anon();
    expect((await a.agent.post('/api/auth/password/reset').set('x-csrf-token', a.csrf).send({ token, password: 'brand-new-password-1' })).status).toBe(400);
  });

  it('forgot-password is rate limited', async () => {
    const e = await setup({ rateLimit: { windowMs: 60000, max: 2 }, emailEnabled: true });
    const a = request.agent(e.app);
    const csrf = await getCsrf(a);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await a.post('/api/auth/password/forgot').set('x-csrf-token', csrf).send({ email: 'x@y.co' })).status);
    expect(codes).toEqual([200, 200, 429]);
    await e.close();
  });
});

describe('change password', () => {
  it('requires the current password and invalidates other sessions', async () => {
    const u = await register('changer');
    const other = await anon();
    await other.agent.post('/api/auth/login').set('x-csrf-token', other.csrf).send({ login: 'changer', password: PW });
    expect((await request(env.app).post('/api/me/password').set('x-csrf-token', 'x').send({})).status).toBe(403);
    expect((await send(u, 'post', '/api/me/password', { currentPassword: 'wrong-password!', newPassword: 'new-password-123' })).status).toBe(403);
    const ok = await send(u, 'post', '/api/me/password', { currentPassword: PW, newPassword: 'new-password-123' });
    expect(ok.status).toBe(200);
    expect((await other.agent.get('/api/me')).body.user).toBeNull(); // other device logged out
    expect((await u.agent.get('/api/me')).body.user.username).toBe('changer'); // this device gets a fresh session
    const sessions = await env.db('sessions').where({ user_id: u.id });
    expect(sessions).toHaveLength(1);
    const a = await anon();
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'changer', password: PW })).status).toBe(401);
    expect((await a.agent.post('/api/auth/login').set('x-csrf-token', a.csrf).send({ login: 'changer', password: 'new-password-123' })).status).toBe(200);
  });
});

describe('avatars', () => {
  it('accepts a real image, resizes to 256px WebP, strips metadata, shows on public profile', async () => {
    const jpg = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#1e6bff' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-like-data' } } })
      .jpeg().toBuffer();
    expect(jpg.includes(Buffer.from('secret-gps-like-data'))).toBe(true);
    const r = await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', jpg, { filename: 'me.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(201);
    const url = r.body.user.avatarUrl;
    expect(url).toMatch(/^\/uploads\/avatars\/.+\.webp$/);
    const file = path.join(env.uploadDir, 'avatars', path.basename(url));
    const buf = fs.readFileSync(file);
    const meta = await sharp(buf).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
    expect(meta.exif).toBeUndefined();
    expect(buf.includes(Buffer.from('secret-gps-like-data'))).toBe(false);
    expect((await request(env.app).get(`/api/users/${player.username}`)).body.user.avatarUrl).toBe(url);
    expect((await request(env.app).get(url)).status).toBe(200);
    // replacing deletes the old file
    const png = await sharp({ create: { width: 50, height: 50, channels: 4, background: '#19d3e6' } }).png().toBuffer();
    const r2 = await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    expect(r2.status).toBe(201);
    expect(fs.existsSync(file)).toBe(false);
    expect((await send(player, 'delete', '/api/me/avatar')).status).toBe(200);
    expect((await request(env.app).get(`/api/users/${player.username}`)).body.user.avatarUrl).toBe('');
  });

  it('rejects non-images, spoofed types, oversized files, and anonymous uploads', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', html, { filename: 'x.png', contentType: 'image/png' })).status).toBe(400);
    expect((await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', html, { filename: 'x.html', contentType: 'text/html' })).status).toBe(400);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', svg, { filename: 'x.svg', contentType: 'image/svg+xml' })).status).toBe(400);
    const truncated = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100)]); // PNG magic, garbage body
    expect((await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', truncated, { filename: 'x.png', contentType: 'image/png' })).status).toBe(400);
    const big = Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.alloc(2 * 1024 * 1024 + 10)]);
    expect((await player.agent.post('/api/me/avatar').set('x-csrf-token', player.csrf).attach('file', big, { filename: 'big.jpg', contentType: 'image/jpeg' })).status).toBe(413);
    const a = await anon();
    expect((await a.agent.post('/api/me/avatar').set('x-csrf-token', a.csrf).attach('file', html, { filename: 'x.png', contentType: 'image/png' })).status).toBe(401);
  });
});

describe('game version history', () => {
  it('Developer adds versions; game page data shows latest + changelog; others blocked', async () => {
    const g = (await send(dev, 'post', '/api/dev/games', { slug: 'sky-crew', title: 'Sky Crew', status: 'published' })).body.game;
    const v = { version: '0.1.0', releasedAt: '2026-11-01', changelog: '- First playable build' };
    for (const u of [player, trusted, admin]) expect((await send(u, 'post', `/api/dev/games/${g.id}/versions`, v)).status).toBe(403);
    expect((await send(dev, 'post', `/api/dev/games/${g.id}/versions`, v)).status).toBe(201);
    expect((await send(dev, 'post', `/api/dev/games/${g.id}/versions`, v)).status).toBe(409);
    expect((await send(dev, 'post', `/api/dev/games/${g.id}/versions`, { version: '0.2.0', releasedAt: '2026-11-09', changelog: '- Luggage physics', downloadUrl: 'https://example.com/sky-crew-0.2.0.zip' })).status).toBe(201);
    expect((await send(dev, 'post', `/api/dev/games/${g.id}/versions`, { version: '0.3.0', releasedAt: 'tomorrow' })).status).toBe(400);
    expect((await send(dev, 'post', `/api/dev/games/${g.id}/versions`, { version: '0.3.0', releasedAt: '2026-12-01', downloadUrl: 'javascript:alert(1)' })).status).toBe(400);
    const pub = (await request(env.app).get('/api/games/sky-crew')).body.game;
    expect(pub.version).toBe('0.2.0');
    expect(pub.latestVersion.version).toBe('0.2.0');
    expect(pub.latestVersion.changelog).toContain('Luggage physics');
    expect(pub.versions.map((x: any) => x.version)).toEqual(['0.2.0', '0.1.0']);
    const vid = pub.versions[0].id;
    expect((await send(admin, 'delete', `/api/dev/games/${g.id}/versions/${vid}`)).status).toBe(403);
    expect((await send(dev, 'delete', `/api/dev/games/${g.id}/versions/${vid}`)).status).toBe(200);
    expect((await request(env.app).get('/api/games/sky-crew')).body.game.version).toBe('0.1.0');
    expect(await env.db('audit_logs').where({ action: 'game.version.add' }).count({ n: '*' }).first()).toEqual({ n: 2 });
  });
});

describe('player statistics', () => {
  it('Developer-only and returns sensible numbers', async () => {
    for (const u of [player, trusted, admin]) expect((await u.agent.get('/api/dev/stats')).status).toBe(403);
    expect((await request(env.app).get('/api/dev/stats')).status).toBe(401);
    const s = (await dev.agent.get('/api/dev/stats')).body;
    const total = Number((await env.db('users').count({ n: '*' }).first())!.n);
    expect(s.totalUsers).toBe(total);
    expect(s.signups7d).toBe(total);
    expect(s.signups30d).toBe(total);
    expect(s.byRole.DEVELOPER).toBe(1);
    expect(s.byRole.ADMIN).toBe(1);
    expect(s.byRole.TRUSTED).toBe(1);
    expect(Object.values(s.byRole).reduce((a: any, b: any) => a + b, 0)).toBe(total);
    expect(s.dailySignups).toHaveLength(30);
    expect(s.dailySignups.reduce((a: number, d: any) => a + d.count, 0)).toBe(total);
    expect(s.activeSessionUsers).toBeGreaterThan(0);
    expect(typeof s.bannedUsers).toBe('number');
  });
});

describe('new pages', () => {
  it('are served', async () => {
    for (const p of ['/news', '/news/anything', '/settings', '/forgot-password', '/reset-password?token=x', '/verify-email?token=x']) {
      expect((await request(env.app).get(p)).status, p).toBe(200);
    }
  });
});
