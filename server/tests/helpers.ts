import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createDb, migrate } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/lib/crypto.js';
import type { Role } from '../src/lib/permissions.js';
import type { AppConfig } from '../src/config.js';

export const PW = 'correct-horse-battery';

export async function setup(overrides: Partial<AppConfig> = {}) {
  const db = createDb(':memory:');
  await migrate(db);
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-up-'));
  const { app } = createApp(db, { cookieSecure: false, rateLimit: { windowMs: 60000, max: 1000 }, gameServerKey: 'test-game-server-key-123', uploadDir, ...overrides });
  let n = 0;
  const hashed = await hashPassword(PW);

  /** Creates a user directly in the DB (server-side) and returns a logged-in agent. */
  async function user(role: Role, name?: string) {
    const username = name ?? `${role.toLowerCase()}${++n}`;
    const [id] = await db('users').insert({ username, username_lower: username.toLowerCase(), email: `${username}@test.dev`, email_lower: `${username}@test.dev`.toLowerCase(), password_hash: hashed, role, display_name: username, created_at: new Date().toISOString() });
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ login: username, password: PW });
    if (res.status !== 200) throw new Error('login failed ' + res.status + JSON.stringify(res.body));
    return { id: Number(id), username, agent, csrf: cookieCsrf(res) ?? csrf };
  }
  return { db, app, user, close: () => db.destroy() };
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
