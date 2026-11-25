import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setup } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
let dev: any, dev2: any, admin: any, trusted: any, player: any;

beforeAll(async () => {
  env = await setup();
  dev = await env.user('DEVELOPER', 'Owner');
  dev2 = await env.user('DEVELOPER', 'CoOwner');
  admin = await env.user('ADMIN');
  trusted = await env.user('TRUSTED');
  player = await env.user('PLAYER', 'Pilot');
  const now = new Date().toISOString();
  await env.db('games').insert({
    slug: 'sky-crew', title: 'Sky Crew', status: 'published', play_url: '/play/sky-crew',
    settings: JSON.stringify({ earlyAccessOnly: true, playEnabled: true }),
    created_at: now, updated_at: now, published_at: now,
  });
});
afterAll(async () => { await env.close(); });

const post = (u: any, url: string, body: object = {}) => u.agent.post(url).set('x-csrf-token', u.csrf).send(body);
const del = (u: any, url: string) => u.agent.delete(url).set('x-csrf-token', u.csrf);

describe('preview passes', () => {
  it('only Admin and Developer can grant, and a Developer cannot be affected', async () => {
    expect((await post(player, '/api/admin/passes', { handle: 'Pilot', kind: 'early_access' })).status).toBe(403);
    expect((await post(trusted, '/api/admin/passes', { handle: 'Pilot', kind: 'early_access' })).status).toBe(403);
    expect((await post(admin, '/api/admin/passes', { handle: dev.username, kind: 'early_access' })).status).toBe(403);
    expect((await post(dev, '/api/admin/passes', { handle: dev2.username, kind: 'early_access' })).status).toBe(403);
    expect((await post(admin, '/api/admin/passes', { handle: admin.username, kind: 'early_access' })).status).toBe(403);

    const ok = await post(admin, '/api/admin/passes', { handle: 'Pilot', kind: 'early_access', note: 'week one' });
    expect(ok.status).toBe(201);
    expect(ok.body.pass.kind).toBe('early_access');
    expect(ok.body.pass.active).toBe(true);
    const log = await env.db('audit_logs').where({ action: 'pass.grant', target_id: String(player.id) }).first();
    expect(log).toBeTruthy();
    expect(log.actor_id).toBe(admin.id);

    const mine = await player.agent.get('/api/passes/mine');
    expect(mine.body.signedIn).toBe(true);
    expect(mine.body.passes.some((p: { kind: string; active: boolean }) => p.kind === 'early_access' && p.active)).toBe(true);
    expect((await request(env.app).get('/api/passes/mine')).body).toEqual({ signedIn: false, passes: [] });
  });

  it('gates the game on the server until a pass is active, and staff skip the pass', async () => {
    const locked = async (u?: any) => (u ? u.agent : request(env.app)).get('/play/sky-crew');
    const token = (u: any) => post(u, '/api/game/token', { game: 'sky-crew' });

    // Pilot holds the pass from the previous test.
    expect((await locked(player)).status).toBe(200);
    expect((await token(player)).status).toBe(200);

    const crew = await post(dev, '/api/admin/passes', { handle: trusted.username, kind: 'crew' });
    expect(crew.status).toBe(201);
    // A crew card is not a preview pass. Trusted still opens the game because they are staff.
    expect((await locked(trusted)).status).toBe(200);

    const stranger = await env.user('PLAYER', 'Walker');
    expect((await locked()).status).toBe(401);
    expect((await locked(stranger)).status).toBe(403);
    expect((await token(stranger)).status).toBe(403);

    const soon = new Date(Date.now() + 86400000).toISOString();
    const timed = await post(dev, '/api/admin/passes', { handle: 'Walker', kind: 'early_access', expiresAt: soon });
    expect(timed.status).toBe(201);
    expect((await token(stranger)).status).toBe(200);

    const gone = await del(dev, `/api/admin/passes/${timed.body.pass.id}`);
    expect(gone.status).toBe(200);
    expect(gone.body.pass.active).toBe(false);
    expect((await token(stranger)).status).toBe(403);
    const revoked = await env.db('audit_logs').where({ action: 'pass.revoke' }).first();
    expect(revoked).toBeTruthy();

    const expired = await post(admin, '/api/admin/passes', { handle: 'Walker', kind: 'early_access', expiresAt: new Date(Date.now() - 3600000).toISOString() });
    expect(expired.status).toBe(201);
    expect(expired.body.pass.active).toBe(false);
    expect((await locked(stranger)).status).toBe(403);

    // Developer still cannot revoke a pass onto a Developer account (there is none), and cannot grant one.
    expect((await post(dev, '/api/admin/passes', { handle: dev2.username, kind: 'crew' })).status).toBe(403);
  });

  it('saves feedback for staff and hides it from players', async () => {
    const sent = await post(player, '/api/feedback', { message: 'The cabin lights flicker on my iPad.', page: '/' });
    expect(sent.status).toBe(201);
    expect((await player.agent.get('/api/admin/feedback')).status).toBe(403);
    const seen = await admin.agent.get('/api/admin/feedback');
    expect(seen.status).toBe(200);
    expect(seen.body.feedback.some((f: { message: string; handle: string }) => f.message.includes('cabin lights') && f.handle === 'Pilot')).toBe(true);
    expect((await trusted.agent.get('/api/admin/feedback')).status).toBe(200);
  });
});
