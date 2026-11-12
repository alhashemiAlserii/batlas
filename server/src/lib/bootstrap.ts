import type { Knex } from 'knex';
import { hashPassword } from './crypto.js';
import { audit } from './audit.js';
import { insertId } from '../db/index.js';
import { usernameSchema, passwordSchema, pinSchema } from './schemas.js';
import { identityColumns } from './identity.js';

/**
 * First-boot Developer account for a fresh production database (e.g. Render). The secret is read
 * from the environment only while NO Developer exists; afterwards the variable is ignored.
 * Prefer BOOTSTRAP_DEVELOPER_PIN. A legacy password does not become the PIN: the owner sets a PIN
 * once on the Set a PIN page. Nothing here is printed.
 *
 *   BOOTSTRAP_DEVELOPER_PIN        4–6 digits. Creates the account with that PIN (they must change it).
 *   BOOTSTRAP_DEVELOPER_PASSWORD   legacy only: creates the account WITHOUT a PIN. They set one
 *                                  on the "Set a PIN" page with this password. Never becomes the PIN.
 *   BOOTSTRAP_DEVELOPER_USERNAME   default "Abood"
 *   BOOTSTRAP_DEVELOPER_EMAIL      optional (email is optional on this site)
 */
export async function bootstrapDeveloper(db: Knex, env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.log): Promise<'created' | 'exists' | 'skipped' | 'error'> {
  const pinRaw = (env.BOOTSTRAP_DEVELOPER_PIN || '').trim();
  const password = env.BOOTSTRAP_DEVELOPER_PASSWORD;
  const dev = await db('users').where({ role: 'DEVELOPER' }).first('id');
  if (dev) {
    if (pinRaw || password) log('NOTE: a Developer already exists, bootstrap secrets are ignored. Delete them from the environment.');
    return 'exists';
  }
  if (!pinRaw && !password) {
    log('No Developer account yet. Set BOOTSTRAP_DEVELOPER_PIN (one time) and restart to create it.');
    return 'skipped';
  }
  const u = usernameSchema.safeParse(env.BOOTSTRAP_DEVELOPER_USERNAME || 'Abood');
  if (!u.success) {
    log('Developer bootstrap skipped: invalid BOOTSTRAP_DEVELOPER_USERNAME.');
    return 'error';
  }
  const handle = u.data;
  if (await db('users').where({ username_lower: handle.toLowerCase() }).orWhere({ handle_lower: handle.toLowerCase() }).first('id')) {
    log(`Developer bootstrap skipped: user "${handle}" already exists (promote it with: npm run create-developer -- --username ${handle} --promote).`);
    return 'error';
  }
  const email = (env.BOOTSTRAP_DEVELOPER_EMAIL || '').trim().toLowerCase() || null;
  const display = handle.toLowerCase() === 'abood' ? 'szpab' : handle;
  let hash: string;
  let pinSet = false;
  let mustChange = false;
  if (pinRaw) {
    const pin = pinSchema.safeParse(pinRaw);
    if (!pin.success) {
      log('Developer bootstrap skipped: BOOTSTRAP_DEVELOPER_PIN must be 4 to 6 digits.');
      return 'error';
    }
    hash = await hashPassword(pin.data);
    pinSet = true;
    mustChange = true;
  } else {
    const p = passwordSchema.safeParse(password);
    if (!p.success) {
      log('Developer bootstrap skipped: BOOTSTRAP_DEVELOPER_PASSWORD must be at least 10 characters, or set BOOTSTRAP_DEVELOPER_PIN.');
      return 'error';
    }
    hash = await hashPassword(p.data);
  }
  const id = await insertId(db('users').insert({
    ...identityColumns(handle),
    email,
    email_lower: email,
    password_hash: hash,
    pin_set: pinSet,
    role: 'DEVELOPER',
    display_name: display,
    must_change_password: mustChange,
    created_at: new Date().toISOString(),
  }));
  await audit(db, null, { action: 'developer.create.bootstrap', category: 'roles', targetType: 'user', targetId: id, targetLabel: handle }, { id: 0, username: 'server-bootstrap', role: 'SYSTEM' });
  if (pinSet) log(`Created Developer "${handle}". Sign in with the bootstrap PIN, choose a new PIN, then delete BOOTSTRAP_DEVELOPER_PIN.`);
  else log(`Created Developer "${handle}" without a PIN. Open Set a PIN and use the bootstrap password once, then delete BOOTSTRAP_DEVELOPER_PASSWORD.`);
  return 'created';
}
