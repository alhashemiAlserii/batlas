/**
 * The ONLY way to create the first Developer (owner) account. Runs on the server machine,
 * never exposed over HTTP.
 *
 *   npm run create-developer -- --username Abood [--email you@example.com] [--password-file path] [--promote]
 *
 * Secret: a 4–6 digit PIN from --password-file or env DEV_PASSWORD when that value is a PIN,
 * otherwise a PIN is generated and written to --out (default ./data/developer-credentials.txt, chmod 600).
 * A longer password in the file is stored only so the owner can set a PIN once; it is not a sign-in password.
 * The secret is never printed.
 * --promote upgrades an existing account (matched by handle) to DEVELOPER instead.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createDb, migrate, insertId } from '../db/index.js';
import { dbTarget, SERVER_ROOT } from '../config.js';
import { hashPassword } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { usernameSchema, passwordSchema, pinSchema } from '../lib/schemas.js';
import { identityColumns } from '../lib/identity.js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    email: { type: 'string' },
    'password-file': { type: 'string' },
    out: { type: 'string' },
    promote: { type: 'boolean', default: false },
  },
});

const username = usernameSchema.parse(values.username ?? '');
const db = createDb(dbTarget());
await migrate(db);

try {
  const existing = await db('users').where({ username_lower: username.toLowerCase() }).first();
  if (values.promote) {
    if (!existing) throw new Error(`No user "${username}" to promote.`);
    await db('users').where({ id: existing.id }).update({ role: 'DEVELOPER', banned: false, ban_reason: null });
    await audit(db, null, { action: 'role.change.cli', category: 'roles', targetType: 'user', targetId: existing.id, targetLabel: username, details: { from: existing.role, to: 'DEVELOPER', via: 'cli' } }, { id: 0, username: 'server-cli', role: 'SYSTEM' });
    console.log(`Promoted ${username} to DEVELOPER.`);
  } else {
    if (existing) throw new Error(`User "${username}" already exists. Use --promote to upgrade it.`);
    // email is optional on this site (school iPads); validate it only when given
    const email = String(values.email ?? '').trim().toLowerCase() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Provide a valid --email');
    let password: string;
    let generated = false;
    if (values['password-file']) password = fs.readFileSync(values['password-file'], 'utf8').trim();
    else if (process.env.DEV_PASSWORD) password = process.env.DEV_PASSWORD;
    else {
      password = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
      generated = true;
    }
    if (!pinSchema.safeParse(password).success) passwordSchema.parse(password);
    const id = await insertId(db('users').insert({
      ...identityColumns(username),
      email,
      email_lower: email,
      password_hash: await hashPassword(password),
      pin_set: pinSchema.safeParse(password).success,
      role: 'DEVELOPER',
      display_name: username.toLowerCase() === 'abood' ? 'szpab' : username,
      must_change_password: pinSchema.safeParse(password).success,
      created_at: new Date().toISOString(),
    }));
    await audit(db, null, { action: 'developer.create.cli', category: 'roles', targetType: 'user', targetId: id, targetLabel: username }, { id: 0, username: 'server-cli', role: 'SYSTEM' });
    if (generated) {
      const out = path.resolve(values.out ?? path.join(SERVER_ROOT, 'data', 'developer-credentials.txt'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `handle=${username}\nusername=${username}\nemail=${email ?? ''}\npin=${password}\n`, { mode: 0o600 });
      console.log(`Created DEVELOPER ${username}. PIN written to ${out} (chmod 600). It is not printed here.`);
    } else {
      console.log(`Created DEVELOPER ${username}.`);
    }
  }
} catch (e) {
  console.error('Error:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
