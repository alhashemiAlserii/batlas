import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setup } from './helpers.js';

const TOKEN = 'b'.repeat(20) + 'test-backup-token-0123456789abcdef';

describe('GET /api/internal/backup', () => {
  it('is 404 when BACKUP_TOKEN is unset or shorter than 32 chars', async () => {
    for (const backupToken of [null, 'short-token-123']) {
      const env = await setup({ backupToken });
      const r = await request(env.app).get('/api/internal/backup').set('authorization', `Bearer ${backupToken ?? 'x'}`);
      expect(r.status).toBe(404);
      await env.close();
    }
  });
  it('needs the exact bearer token; sends no cookies; dumps every table; audit-logs each call', async () => {
    const env = await setup({ backupToken: TOKEN });
    await env.user('DEVELOPER', 'abood');
    for (const auth of [undefined, 'Bearer wrong', `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN]) {
      const req = request(env.app).get('/api/internal/backup');
      const r = auth ? await req.set('authorization', auth) : await req;
      expect(r.status).toBe(401);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    const r = await request(env.app).get('/api/internal/backup').set('authorization', `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Object.keys(r.body.tables)).toEqual(expect.arrayContaining(['users', 'sessions', 'audit_logs', 'game_flights']));
    expect(r.body.tables.users.map((u: any) => u.username)).toContain('abood');
    const logs = await env.db('audit_logs').whereIn('action', ['backup.download', 'backup.denied']).select('action');
    expect(logs.filter((l: any) => l.action === 'backup.download')).toHaveLength(1);
    expect(logs.filter((l: any) => l.action === 'backup.denied')).toHaveLength(5);
    await env.close();
  });
  it('is rate limited', async () => {
    const env = await setup({ backupToken: TOKEN, backupRateLimit: 2 });
    const get = () => request(env.app).get('/api/internal/backup').set('authorization', `Bearer ${TOKEN}`);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
    await env.close();
  });
});

describe('DELETE /api/admin/users/:id (Developer delete account)', () => {
  it('Developer deletes a Player and all dependent rows, with confirmation and an audit entry', async () => {
    const env = await setup();
    const dev = await env.user('DEVELOPER', 'abood');
    const p = await env.user('PLAYER', 'live_x1');
    // dependent rows: an extra session (from login), a game token and a flight
    const tok = await p.agent.post('/api/game/token').set('x-csrf-token', p.csrf).send({});
    expect(tok.status).toBe(200);
    const fl = await p.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', p.csrf).send({ score: 500, stars: 3, landing: 'good', route: 'CRP', crashed: false, duration: 60 });
    expect(fl.status).toBeLessThan(300);
    // missing / wrong confirmation -> nothing deleted
    expect((await dev.agent.delete(`/api/admin/users/${p.id}`).set('x-csrf-token', dev.csrf).send({})).status).toBe(400);
    expect((await dev.agent.delete(`/api/admin/users/${p.id}`).set('x-csrf-token', dev.csrf).send({ confirm: 'LIVE_X1' })).status).toBe(400);
    expect(await env.db('users').where({ id: p.id }).first()).toBeTruthy();
    // without CSRF -> refused
    expect((await dev.agent.delete(`/api/admin/users/${p.id}`).send({ confirm: 'live_x1' })).status).toBe(403);
    const r = await dev.agent.delete(`/api/admin/users/${p.id}`).set('x-csrf-token', dev.csrf).send({ confirm: 'live_x1' });
    expect(r.status).toBe(200);
    expect(r.body.removed.sessions).toBeGreaterThan(0);
    expect(r.body.removed.game_tokens).toBe(1);
    expect(r.body.removed.game_flights).toBe(1);
    for (const t of ['sessions', 'game_tokens', 'game_flights']) expect(Number((await env.db(t).where({ user_id: p.id }).count({ n: '*' }).first())!.n)).toBe(0);
    expect(await env.db('users').where({ id: p.id }).first()).toBeUndefined();
    const a = await env.db('audit_logs').where({ action: 'player.delete' }).first();
    expect(a.actor_username).toBe('abood');
    expect(a.target_label).toBe('live_x1');
    // their old session no longer works
    expect((await p.agent.get('/api/me')).body.user).toBeNull();
    // 404 for an unknown id
    expect((await dev.agent.delete(`/api/admin/users/${p.id}`).set('x-csrf-token', dev.csrf).send({ confirm: 'live_x1' })).status).toBe(404);
    await env.close();
  });
  it('refuses to delete a Developer or yourself, and is Developer-only', async () => {
    const env = await setup();
    const dev = await env.user('DEVELOPER', 'abood');
    const dev2 = await env.user('DEVELOPER', 'owner2');
    const admin = await env.user('ADMIN', 'mod1');
    const p = await env.user('PLAYER', 'victim');
    const del = (who: any, id: number, confirm: string) => who.agent.delete(`/api/admin/users/${id}`).set('x-csrf-token', who.csrf).send({ confirm });
    const self = await del(dev, dev.id, 'abood');
    expect(self.status).toBe(403);
    const other = await del(dev, dev2.id, 'owner2');
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('protected');
    expect((await del(admin, p.id, 'victim')).status).toBe(403);
    expect((await del(p, admin.id, 'mod1')).status).toBe(403);
    expect(Number((await env.db('users').count({ n: '*' }).first())!.n)).toBe(4);
    expect(await env.db('audit_logs').where({ action: 'player.delete.denied' }).count({ n: '*' }).first()).toMatchObject({});
    await env.close();
  });
});
