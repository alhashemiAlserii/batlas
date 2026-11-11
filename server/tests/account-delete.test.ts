import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { setup, PW, getCsrf } from './helpers.js';
import { deleteOwnAccount } from '../src/lib/account-delete.js';
import { storeMedia } from '../src/lib/media.js';
import { PNG } from './restore-seed.js';

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env | null = null;
afterEach(async () => { await env?.close(); env = null; });
const count = async (t: string, where: Record<string, unknown>) => Number((await env!.db(t).where(where).count({ n: '*' }).first())!.n);

/** A player with data in every table that points at users. */
async function richPlayer(name = 'Pilot_Sam') {
  const dev = await env!.user('DEVELOPER', 'abood');
  const p = await env!.user('PLAYER', name);
  expect((await p.agent.post('/api/game/token').set('x-csrf-token', p.csrf).send({})).status).toBe(200);
  expect((await p.agent.post('/api/game/sky-crew/flights').set('x-csrf-token', p.csrf).send({ score: 900, stars: 3, landing: 'butter', route: 'CRP', crashed: false, duration: 80 })).status).toBeLessThan(300);
  const av = await storeMedia(env!.db, { kind: 'avatar', contentType: 'image/webp', data: PNG, userId: p.id });
  await env!.db('users').where({ id: p.id }).update({ avatar_url: av.url, display_name: 'Sam The Pilot', email: 'sam@example.com', email_lower: 'sam@example.com' });
  const img = await storeMedia(env!.db, { kind: 'image', contentType: 'image/png', data: PNG, userId: p.id });
  await env!.db('auth_tokens').insert({ token_hash: 'tok-' + p.id, user_id: p.id, purpose: 'verify_email', created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1e6).toISOString() });
  await env!.db('news_posts').insert({ slug: 'by-sam', title: 'By Sam', body: 'b', author_id: p.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await env!.db('contact_messages').insert({ name: 'Sam', email: 'sam@example.com', subject: 's', message: 'hello', user_id: p.id, ip: '10.0.0.9', created_at: new Date().toISOString() });
  // past audit entries that name them: as actor, as target, and inside details
  await env!.db('audit_logs').insert([
    { actor_id: p.id, actor_username: name, actor_role: 'PLAYER', action: 'auth.login', category: 'auth', ip: '10.0.0.9', created_at: new Date().toISOString() },
    { actor_id: dev.id, actor_username: 'abood', actor_role: 'DEVELOPER', action: 'player.kick', category: 'moderation', target_type: 'user', target_id: String(p.id), target_label: name, details: JSON.stringify({ reason: `${name} was rude`, player: name }), ip: '1.1.1.1', created_at: new Date().toISOString() },
    { actor_id: dev.id, actor_username: 'abood', actor_role: 'DEVELOPER', action: 'game.kick', category: 'game', target_type: 'room', target_id: 'ABCD', target_label: name.toLowerCase(), details: JSON.stringify({ players: [name, 'other'], note: 'Pilot_Samantha is someone else' }), created_at: new Date().toISOString() },
    { actor_id: dev.id, actor_username: 'abood', actor_role: 'DEVELOPER', action: 'player.profile_edit', category: 'moderation', target_type: 'user', target_id: String(p.id), target_label: name, details: JSON.stringify({ before: { displayName: 'Sam The Pilot' } }), created_at: new Date().toISOString() },
  ]);
  return { dev, p, img };
}
const del = (u: { agent: any; csrf: string }, body: Record<string, unknown>) => u.agent.post('/api/me/delete').set('x-csrf-token', u.csrf).send(body);

describe('POST /api/me/delete (delete my own account)', () => {
  it('refuses a wrong password and a wrong / differently-cased username, deleting nothing', async () => {
    env = await setup();
    const { p } = await richPlayer();
    const a = await del(p, { username: 'Pilot_Sam', password: 'wrong-password-123' });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe('bad_credentials');
    for (const username of ['pilot_sam', 'Pilot_Sam ', 'abood']) {
      const r = await del(p, { username, password: PW });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('confirm_required');
    }
    expect((await del(p, { password: PW })).status).toBe(400);
    expect(await env.db('users').where({ id: p.id }).first()).toBeTruthy();
    expect((await p.agent.get('/api/me')).body.user.username).toBe('Pilot_Sam');
    expect(await count('audit_logs', { action: 'account.self_delete.denied' })).toBe(4);
  });

  it('blocks every Developer on the server side', async () => {
    env = await setup();
    const dev = await env.user('DEVELOPER', 'abood');
    const r = await del(dev, { username: 'abood', password: PW });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('protected');
    expect(await env.db('users').where({ id: dev.id }).first()).toBeTruthy();
    // and the core refuses too, even if a route forgot to check
    await expect(deleteOwnAccount(env.db, dev.id)).rejects.toThrow(/Developer/);
    expect(await env.db('users').where({ id: dev.id }).first()).toBeTruthy();
  });

  it('needs a website session (not a game token) and CSRF', async () => {
    env = await setup();
    const p = await env.user('PLAYER', 'gamer1');
    const tok = (await p.agent.post('/api/game/token').set('x-csrf-token', p.csrf).send({})).body.token;
    const viaToken = await request(env.app).post('/api/me/delete').set('authorization', `Bearer ${tok}`).send({ username: 'gamer1', password: PW });
    expect([401, 403]).toContain(viaToken.status);
    expect((await p.agent.post('/api/me/delete').send({ username: 'gamer1', password: PW })).status).toBe(403); // no CSRF
    expect(await env.db('users').where({ id: p.id }).first()).toBeTruthy();
  });

  it('deletes the account: no more login, data gone or anonymised, audit rows kept with deleted-user-<id>', async () => {
    env = await setup();
    const { dev, p, img } = await richPlayer();
    const auditBefore = await count('audit_logs', {});
    const r = await del(p, { username: 'Pilot_Sam', password: PW });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const anon = `deleted-user-${p.id}`;
    expect(r.body.deleted).toBe(anon);
    // login and the old session are gone
    expect((await p.agent.get('/api/me')).body.user).toBeNull();
    const fresh = request.agent(env.app);
    const csrf = await getCsrf(fresh);
    expect((await fresh.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: 'Pilot_Sam', password: PW })).status).toBe(401);
    // data
    expect(await env.db('users').where({ id: p.id }).first()).toBeUndefined();
    for (const t of ['sessions', 'game_tokens', 'auth_tokens', 'game_flights']) expect(await count(t, { user_id: p.id })).toBe(0);
    expect(await count('media', { kind: 'avatar' })).toBe(0);
    expect((await env.db('media').where({ id: img.id }).first()).uploaded_by).toBeNull(); // kept, unlinked
    expect((await env.db('news_posts').where({ slug: 'by-sam' }).first()).author_id).toBeNull();
    const cm = await env.db('contact_messages').first();
    expect(cm).toMatchObject({ user_id: null, name: anon, ip: null, message: 'hello' });
    expect(cm.email).not.toContain('sam@');
    // audit: every old row kept, plus one new entry; their name appears nowhere
    expect(await count('audit_logs', {})).toBe(auditBefore + 1);
    const all = await env.db('audit_logs').select('*');
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/Pilot_Sam(?!antha)/i);
    expect(text).not.toContain('Sam The Pilot');
    expect(text).not.toContain('sam@example.com');
    expect(text).toContain('Pilot_Samantha is someone else'); // other people's names untouched
    expect(text).toContain('abood');
    const login = all.find((x: any) => x.action === 'auth.login' && Number(x.actor_id) === p.id);
    expect(login).toMatchObject({ actor_username: anon, ip: null });
    const kick = all.find((x: any) => x.action === 'player.kick');
    expect(kick.target_label).toBe(anon);
    expect(JSON.parse(kick.details)).toEqual({ reason: `${anon} was rude`, player: anon });
    expect(kick.ip).toBe('1.1.1.1'); // the Developer's own IP stays
    expect(JSON.parse(all.find((x: any) => x.action === 'game.kick').details).players).toEqual([anon, 'other']);
    const entry = all.find((x: any) => x.action === 'account.self_delete');
    expect(entry).toMatchObject({ actor_username: anon, target_label: anon, target_id: String(p.id), ip: null, category: 'auth' });
    expect(JSON.parse(entry.details).removed).toMatchObject({ game_flights: 1, game_tokens: 1, avatars: 1, auth_tokens: 1 });
    // the Developer is untouched
    expect((await dev.agent.get('/api/me')).body.user.username).toBe('abood');
  });

  it('rolls everything back when a step fails', async () => {
    env = await setup();
    const { p } = await richPlayer();
    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const t of ['users', 'sessions', 'game_tokens', 'auth_tokens', 'game_flights', 'media', 'news_posts', 'contact_messages', 'audit_logs']) out[t] = await env!.db(t).select('*').orderBy(t === 'sessions' ? 'id_hash' : t === 'game_tokens' || t === 'auth_tokens' ? 'token_hash' : 'id');
      return JSON.stringify(out);
    };
    const before = await snapshot();
    await expect(deleteOwnAccount(env.db, p.id, { beforeCommit: async () => { throw new Error('boom'); } })).rejects.toThrow('boom');
    expect(await snapshot()).toBe(before);
    expect((await p.agent.get('/api/me')).body.user.username).toBe('Pilot_Sam');
  });

  it('is rate-limited per account', async () => {
    env = await setup();
    const p = await env.user('PLAYER', 'tryhard');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await del(p, { username: 'tryhard', password: 'nope-nope-nope' })).status);
    expect(codes.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
    expect(codes[5]).toBe(429);
    expect(await env.db('users').where({ id: p.id }).first()).toBeTruthy();
  });
});
