import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { insertId } from '../src/db/index.js';
import { storeMedia } from '../src/lib/media.js';

export const iso = (s: number) => new Date(Date.UTC(2026, 10, 1) + s * 1000).toISOString();
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(3000)]);
export const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), crypto.randomBytes(300_000)]);

/** Fills a migrated database so every app table has rows, with binary media and gaps in the ids. */
export async function seed(db: Knex) {
  const users: number[] = [];
  for (const [i, role] of (['DEVELOPER', 'ADMIN', 'TRUSTED', 'PLAYER', 'PLAYER'] as const).entries()) {
    users.push(await insertId(db('users').insert({ username: `u${i}`, username_lower: `u${i}`, password_hash: 'x', role, display_name: `U${i}`, banned: i === 4, created_at: iso(i) })));
  }
  await db('users').where({ id: users[3] }).del(); // id gap: max(id) != count
  await db('sessions').insert({ id_hash: 'h1', user_id: users[0], created_at: iso(10), expires_at: iso(99999) });
  await db('auth_tokens').insert({ token_hash: 'a1', user_id: users[1], purpose: 'reset_password', created_at: iso(11), expires_at: iso(99999) });
  await db('game_tokens').insert({ token_hash: 't1', user_id: users[1], game_slug: 'sky-crew', created_at: iso(11), expires_at: iso(99999) });
  const g = await insertId(db('games').insert({ slug: 'sky-crew', title: 'Sky Crew', status: 'published', screenshots: '[]', created_at: iso(12), updated_at: iso(12) }));
  await db('game_versions').insert({ game_id: g, version: '1.0.0', released_at: '2026-11-01', changelog: 'first', created_at: iso(13) });
  await db('news_posts').insert({ slug: 'hello', title: 'Hello', body: 'b', author_id: users[0], game_id: g, published_at: iso(14), created_at: iso(14), updated_at: iso(14) });
  await db('game_flights').insert({ user_id: users[2], game_slug: 'sky-crew', score: 10, crashed: true, created_at: iso(15) });
  await db('contact_messages').insert({ name: 'n', email: 'n@x.dev', subject: 's', message: 'm', created_at: iso(16) });
  const m1 = await storeMedia(db, { kind: 'image', contentType: 'image/png', data: PNG, gameId: g, userId: users[0], filename: 'shot.png' });
  const m2 = await storeMedia(db, { kind: 'video', contentType: 'video/mp4', data: MP4, gameId: g, userId: users[0], filename: 'trailer.mp4' });
  await db('site_settings').insert({ key: 'maintenance', value: JSON.stringify({ on: false }), updated_by: users[0], updated_at: iso(17) });
  await db('site_events').insert({ title: 'Launch', announce_at: iso(18), starts_at: iso(19), ends_at: iso(20), created_by: users[0], game_id: g, created_at: iso(18), updated_at: iso(18) });
  // Sky Crew outfits + economy (game-revision tables)
  await db('game_profiles').insert({ user_id: users[2], game_slug: 'sky-crew', outfit: JSON.stringify({ body: 'a' }), updated_at: iso(21) });
  await db('wallets').insert({ user_id: users[2], balance: 120, updated_at: iso(22) });
  for (const [i, d] of [200, -80].entries()) await db('wallet_ledger').insert({ user_id: users[2], delta: d, balance_after: [200, 120][i], kind: i ? 'purchase' : 'salary', ref: `r${i}`, details: '{}', created_at: iso(22 + i) });
  await db('owned_items').insert({ user_id: users[2], item_key: 'outfit:test', source: 'purchase', created_at: iso(23) });
  await db('auth_lockouts').insert({ scope: 'ip', subject: '203.0.113.5', failures: 1, window_start: iso(24) });
  for (let i = 0; i < 7; i++) await db('audit_logs').insert({ actor_id: users[0], actor_username: 'u0', actor_role: 'DEVELOPER', action: `test.${i}`, category: 'admin', created_at: iso(30 + i) });
  return { users, media: [m1, m2] };
}
