import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDb, migrate, insertId } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/crypto.js';
import type { Role } from '../src/lib/permissions.js';
import type { AppConfig } from '../src/config.js';
import { MemoryMailer } from '../src/lib/mailer.js';

/** Obvious test-only PIN. Not a real account secret. */
export const TEST_PIN = '000000';
/** @deprecated Same value as TEST_PIN. Older tests still pass it in the `password` field, which the server accepts as a PIN alias. */
export const PW = TEST_PIN;

/**
 * Fresh, migrated test database. In-memory SQLite by default; with TEST_DATABASE_URL set, a
 * throw-away schema in that Postgres (so parallel test files never share tables).
 */
export async function testDb(opts: { migrate?: boolean } = {}) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { const db = createDb(':memory:'); if (opts.migrate !== false) await migrate(db); return db; }
  const schema = `t_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = createDb(url);
  await admin.raw(`create schema "${schema}"`);
  await admin.destroy();
  const db = createDb(url, { schema });
  if (opts.migrate !== false) await migrate(db);
  // drop the schema again when the test closes the connection
  const destroy = db.destroy.bind(db);
  try {
    Object.defineProperty(db, 'destroy', { configurable: true, value: async () => { await db.raw(`drop schema "${schema}" cascade`).catch(() => {}); return destroy(); } });
  } catch { /* leave the schema behind; the test database is throw-away */ }
  return db;
}

export async function setup(overrides: Partial<AppConfig> = {}) {
  const db = await testDb();
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-up-'));
  const mailer = new MemoryMailer();
  const { app } = createApp(db, { cookieSecure: false, rateLimit: { windowMs: 60000, max: 1000 }, contactRateLimit: { windowMs: 60000, max: 1000 }, gameServerKey: 'test-game-server-key-123', uploadDir, publicUrl: 'http://test.local', ...overrides }, { mailer });
  let n = 0;
  const hashed = await hashPassword(PW);

  /** Creates a user directly in the DB (server-side) and returns a logged-in agent. */
  async function user(role: Role, name?: string) {
    const username = name ?? `${role.toLowerCase()}${++n}`;
    const id = await insertId(db('users').insert({ username, username_lower: username.toLowerCase(), handle: username, handle_lower: username.toLowerCase(), email: `${username}@test.dev`, email_lower: `${username}@test.dev`.toLowerCase(), password_hash: hashed, pin_set: true, role, display_name: username, created_at: new Date().toISOString() }));
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: username, pin: PW });
    if (res.status !== 200) throw new Error('login failed ' + res.status + JSON.stringify(res.body));
    return { id: Number(id), username, agent, csrf: cookieCsrf(res) ?? csrf };
  }
  return { db, app, user, mailer, uploadDir, close: () => db.destroy() };
}

export function cookieCsrf(res: request.Response): string | undefined {
  const set = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
  const c = set.find((s) => s.startsWith('csrf='));
  return c ? decodeURIComponent(c.split(';')[0].slice(5)) : undefined;
}

export async function getCsrf(agent: ReturnType<typeof request.agent>) {
  const r = await agent.get('/api/csrf');
  return r.body.csrfToken as string;
}
