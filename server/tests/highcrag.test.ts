import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup } from './helpers.js';
import { ensureBuiltInGames } from '../src/lib/seed-games.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any;
beforeAll(async () => { env = await setup(); dev = await env.user('DEVELOPER'); });
afterAll(async () => { await env.close(); });

describe('Highcrag built-in game', () => {
  it('serves the game page under the site CSP', async () => {
    const r = await request(env.app).get('/play/highcrag');
    expect(r.status).toBe(200);
    expect(r.text).toContain('/play/highcrag/js/main.js');
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await request(env.app).get('/play/highcrag/js/main.js')).status).toBe(200);
  });

  it('is listed once as upcoming with a play link, without touching other games', async () => {
    const other = await dev.agent.post('/api/dev/games').set('x-csrf-token', dev.csrf).send({ slug: 'sky-crew', title: 'Sky Crew', status: 'upcoming' });
    expect(other.status).toBe(201);
    const silent = () => {};
    expect(await ensureBuiltInGames(env.db, silent)).toEqual(['highcrag']);
    expect(await ensureBuiltInGames(env.db, silent)).toEqual([]);
    const g = (await request(env.app).get('/api/games/highcrag')).body.game;
    expect(g.status).toBe('upcoming');
    expect(g.playUrl).toBe('/play/highcrag');
    const sky = (await request(env.app).get('/api/games/sky-crew')).body.game;
    expect(sky.title).toBe('Sky Crew');
    expect((await request(env.app).get('/api/games')).body.games).toHaveLength(2);
  });

  it('never overrides the Developer\'s later changes', async () => {
    const id = (await env.db('games').where({ slug: 'highcrag' }).first('id')).id;
    await dev.agent.post(`/api/dev/games/${id}/publish`).set('x-csrf-token', dev.csrf).send({ status: 'draft' });
    await ensureBuiltInGames(env.db, () => {});
    expect((await env.db('games').where({ slug: 'highcrag' }).first()).status).toBe('draft');
  });
});
