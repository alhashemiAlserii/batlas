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

  it('shows cover art and screenshots', async () => {
    const g = (await request(env.app).get('/api/games/highcrag')).body.game;
    expect(g.coverImage).toBe('/img/highcrag/cover.jpg');
    expect(g.screenshots).toHaveLength(5);
    expect((await request(env.app).get(g.coverImage)).status).toBe(200);
    for (const s of g.screenshots) expect((await request(env.app).get(s)).status).toBe(200);
  });

  it('refreshes only a listing nobody edited since the first version', async () => {
    const first = (await env.db('games').where({ slug: 'highcrag' }).first());
    const v01 = 'Highcrag is a survival climbing game that runs in your browser. Grab rock walls and haul yourself up ledge by ledge, but every handhold costs stamina.\n\n' +
      'Hunger, cold and injuries shrink your stamina bar, so forage berries and glowcaps, patch yourself up with bandages and light campfires to warm up and save your progress. ' +
      'Climb through four zones: Saltwind Shore, the thorny Mossgrove, the blizzard-swept Frostline and the gusty Ember Crown. Light the beacon at the summit to finish.\n\n' +
      'Every mountain is generated from a seed, so each climb is different. Works with keyboard and mouse or touch (iPad and phone).';
    // As it was first listed: refreshed, status left alone.
    await env.db('games').where({ id: first.id }).update({ version: '0.1', description: v01, cover_image: '', screenshots: null, status: 'upcoming' });
    await ensureBuiltInGames(env.db, () => {});
    let row = await env.db('games').where({ id: first.id }).first();
    expect(row.version).toBe('0.5');
    expect(row.cover_image).toBe('/img/highcrag/cover.jpg');
    expect(row.status).toBe('upcoming');
    // Edited by the Developer (own text): left exactly as it is.
    await env.db('games').where({ id: first.id }).update({ version: '0.1', description: 'My own words', cover_image: '', screenshots: null });
    await ensureBuiltInGames(env.db, () => {});
    row = await env.db('games').where({ id: first.id }).first();
    expect(row.description).toBe('My own words');
    expect(row.version).toBe('0.1');
    // Same text but the Developer added a cover: left alone too.
    await env.db('games').where({ id: first.id }).update({ description: v01, cover_image: '/media/mine.jpg' });
    await ensureBuiltInGames(env.db, () => {});
    expect((await env.db('games').where({ id: first.id }).first()).cover_image).toBe('/media/mine.jpg');
  });

  it('never overrides the Developer\'s later changes', async () => {
    const id = (await env.db('games').where({ slug: 'highcrag' }).first('id')).id;
    await dev.agent.post(`/api/dev/games/${id}/publish`).set('x-csrf-token', dev.csrf).send({ status: 'draft' });
    await ensureBuiltInGames(env.db, () => {});
    expect((await env.db('games').where({ slug: 'highcrag' }).first()).status).toBe('draft');
  });
});
