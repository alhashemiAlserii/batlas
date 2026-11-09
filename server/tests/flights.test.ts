import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const flight = { score: 1234, stars: 4, landing: 'butter', route: 'CRP', crashed: false, duration: 300 };

describe('Sky Crew flights, stats and leaderboard', () => {
  it('needs a session and CSRF, validates and rate-limits', async () => {
    expect((await request(env.app).post('/api/game/sky-crew/flights').send(flight)).status).toBe(403); // no CSRF / session
    const u = await env.user('PLAYER', 'pilot_one');
    expect((await u.agent.post('/api/game/sky-crew/flights').send(flight)).status).toBe(403); // missing CSRF header
    for (const bad of [{ ...flight, score: 999999 }, { ...flight, stars: 9 }, { ...flight, route: 'XXX' }, { ...flight, landing: 'teleport' }, { ...flight, duration: 1 }]) {
      expect((await u.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', u.csrf).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await u.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', u.csrf).send(flight);
    expect(ok.status).toBe(201);
    expect(ok.body.stats).toMatchObject({ flights: 1, bestScore: 1234, landings: 1, butterLandings: 1, crashes: 0 });
    expect((await u.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', u.csrf).send(flight)).status).toBe(429);
  });

  it('shows per-user stats and a top-10 leaderboard without banned users', async () => {
    const a = await env.user('PLAYER', 'ace'), b = await env.user('PLAYER', 'bob'), c = await env.user('PLAYER', 'cheater');
    await a.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', a.csrf).send({ ...flight, score: 2000 });
    await b.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', b.csrf).send({ ...flight, score: 500, landing: 'crash', crashed: true, route: 'PNR' });
    await c.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', c.csrf).send({ ...flight, score: 99999 });
    await env.db('users').where({ username: 'cheater' }).update({ banned: true });
    const lb = (await request(env.app).get('/api/games/sky-crew/leaderboard')).body.leaderboard;
    expect(lb.map((x: any) => x.username)).toEqual(['ace', 'pilot_one', 'bob']);
    expect(lb[0]).toMatchObject({ rank: 1, bestScore: 2000, flights: 1 });
    const st = (await request(env.app).get('/api/users/bob/game-stats')).body.skyCrew;
    expect(st).toMatchObject({ flights: 1, bestScore: 500, landings: 0, crashes: 1 });
    expect((await request(env.app).get('/api/users/cheater/game-stats')).status).toBe(404);
    expect((await request(env.app).get('/api/users/nobody/game-stats')).status).toBe(404);
  });
});
