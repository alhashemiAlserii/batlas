import type { Knex } from 'knex';
import { hashPassword } from './crypto.js';
import { audit } from './audit.js';
import { insertId } from '../db/index.js';
import { usernameSchema, passwordSchema } from './schemas.js';

/**
 * First-boot Developer account for a fresh production database (e.g. Render), without a
 * password ever being committed. Reads BOOTSTRAP_DEVELOPER_PASSWORD only while NO Developer
 * exists; afterwards the variable is ignored (and a warning asks you to delete it).
 * The account must change that password on first sign-in.
 *
 *   BOOTSTRAP_DEVELOPER_PASSWORD   required to bootstrap (min 10 chars)
 *   BOOTSTRAP_DEVELOPER_USERNAME   default "abood"
 *   BOOTSTRAP_DEVELOPER_EMAIL      optional (email is optional on this site)
 */
export async function bootstrapDeveloper(db: Knex, env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.log): Promise<'created' | 'exists' | 'skipped' | 'error'> {
  const password = env.BOOTSTRAP_DEVELOPER_PASSWORD;
  const dev = await db('users').where({ role: 'DEVELOPER' }).first('id');
  if (dev) {
    if (password) log('NOTE: a Developer already exists, BOOTSTRAP_DEVELOPER_PASSWORD is ignored. Delete it from the environment.');
    return 'exists';
  }
  if (!password) {
    log('No Developer account yet. Set BOOTSTRAP_DEVELOPER_PASSWORD (one time) and restart to create it.');
    return 'skipped';
  }
  const u = usernameSchema.safeParse(env.BOOTSTRAP_DEVELOPER_USERNAME || 'abood');
  const p = passwordSchema.safeParse(password);
  if (!u.success || !p.success) {
    log(`Developer bootstrap skipped: ${!u.success ? 'invalid BOOTSTRAP_DEVELOPER_USERNAME' : 'BOOTSTRAP_DEVELOPER_PASSWORD must be at least 10 characters'}.`);
    return 'error';
  }
  const username = u.data;
  if (await db('users').where({ username_lower: username.toLowerCase() }).first('id')) {
    log(`Developer bootstrap skipped: user "${username}" already exists (promote it with: npm run create-developer -- --username ${username} --promote).`);
    return 'error';
  }
  const email = (env.BOOTSTRAP_DEVELOPER_EMAIL || '').trim().toLowerCase() || null;
  const id = await insertId(db('users').insert({
    username,
    username_lower: username.toLowerCase(),
    email,
    email_lower: email,
    password_hash: await hashPassword(p.data),
    role: 'DEVELOPER',
    display_name: username,
    must_change_password: true,
    created_at: new Date().toISOString(),
  }));
  await audit(db, null, { action: 'developer.create.bootstrap', category: 'roles', targetType: 'user', targetId: id, targetLabel: username }, { id: 0, username: 'server-bootstrap', role: 'SYSTEM' });
  log(`Created Developer "${username}" from BOOTSTRAP_DEVELOPER_PASSWORD. Sign in, choose a new password, then delete that variable.`);
  return 'created';
}
