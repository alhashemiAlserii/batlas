import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any, admin: any, player: any;
beforeAll(async () => { env = await setup(); dev = await env.user('DEVELOPER'); admin = await env.user('ADMIN'); player = await env.user('PLAYER'); });
afterAll(async () => { await env.close(); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d2c3a20000000049454e44ae426082', 'hex');

describe('games publishing', () => {
  it('only the Developer can create/edit/publish', async () => {
    const body = { slug: 'sky-crew', title: 'Sky Crew', tagline: 'Co-op chaos at 30,000 ft' };
    expect((await player.agent.post('/api/dev/games').set('x-csrf-token', player.csrf).send(body)).status).toBe(403);
    expect((await admin.agent.post('/api/dev/games').set('x-csrf-token', admin.csrf).send(body)).status).toBe(403);
    const c = await dev.agent.post('/api/dev/games').set('x-csrf-token', dev.csrf).send(body);
    expect(c.status).toBe(201);
    expect(c.body.game.status).toBe('draft');
    // drafts are not public
    expect((await request(env.app).get('/api/games/sky-crew')).status).toBe(404);
    expect((await request(env.app).get('/api/games')).body.games).toHaveLength(0);
    const id = c.body.game.id;
    expect((await admin.agent.post(`/api/dev/games/${id}/publish`).set('x-csrf-token', admin.csrf).send({ status: 'published' })).status).toBe(403);
    const pub = await dev.agent.post(`/api/dev/games/${id}/publish`).set('x-csrf-token', dev.csrf).send({ status: 'published' });
    expect(pub.body.game.status).toBe('published');
    const ed = await dev.agent.patch(`/api/dev/games/${id}`).set('x-csrf-token', dev.csrf).send({ version: '0.1.0', platforms: ['Web', 'Windows'], trailerUrl: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(ed.status).toBe(200);
    const g = (await request(env.app).get('/api/games/sky-crew')).body.game;
    expect(g.version).toBe('0.1.0');
    expect(g.platforms).toEqual(['Web', 'Windows']);
    expect(g).not.toHaveProperty('config');
    const logs = await env.db('audit_logs').where({ category: 'games' }).pluck('action');
    expect(logs).toEqual(expect.arrayContaining(['game.create', 'game.status', 'game.update']));
  });

  it('rejects javascript: URLs', async () => {
    const r = await dev.agent.post('/api/dev/games').set('x-csrf-token', dev.csrf).send({ slug: 'bad', title: 'Bad', playUrl: 'javascript:alert(1)' });
    expect(r.status).toBe(400);
  });

  it('uploads images (developer only, content-checked)', async () => {
    const ok = await dev.agent.post('/api/dev/uploads').set('x-csrf-token', dev.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/media\/\d+\.png$/); // stored in the DB (free-plan disk is wiped on deploy)
    const served = await request(env.app).get(ok.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
    const fake = await dev.agent.post('/api/dev/uploads').set('x-csrf-token', dev.csrf).attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(400);
    const pl = await player.agent.post('/api/dev/uploads').set('x-csrf-token', player.csrf).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(pl.status).toBe(403);
  });

  it('serves public pages', async () => {
    for (const p of ['/', '/games', '/games/sky-crew', '/login', '/register', '/contact', '/u/whoever', '/css/site.css', '/js/common.js', '/img/batlas-mark.png', '/favicon.ico']) {
      expect((await request(env.app).get(p)).status, p).toBe(200);
    }
    expect((await request(env.app).get('/nope')).status).toBe(404);
  });
});
