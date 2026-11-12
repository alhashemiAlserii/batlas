import { maintenanceBlocks } from '../lib/maintenance.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { selfUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword, dummyVerify, sha256, safeEqual } from '../lib/crypto.js';
import { createSession, destroySession, issueCsrf } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { sendVerificationEmail } from './account.js';
import { insertId } from '../db/index.js';
import { handleSchema, optionalDisplayName, optionalEmail } from '../lib/schemas.js';
import { findUserByHandle, handleOf, handleTaken, identityColumns, pinIsSet, readSubmittedPin, requirePin } from '../lib/identity.js';
import { assertUnlocked, clearAccountFailures, recordFailure } from '../lib/lockout.js';

export { handleSchema as usernameSchema, passwordSchema } from '../lib/schemas.js';

// Unknown fields such as `role` are stripped, so a client can never pick its own rank.
const registerSchema = z.object({
  handle: handleSchema.optional(),
  username: handleSchema.optional(), // alias of handle
  displayName: optionalDisplayName,
  email: optionalEmail,
  pin: z.string().max(200).optional(),
  password: z.string().max(200).optional(), // alias of pin; must still be a 4–6 digit PIN
});
const loginSchema = z.object({
  login: z.string().trim().min(1).max(64), // handle only — email is not a sign-in field
  pin: z.string().max(200).optional(),
  password: z.string().max(200).optional(),
});
const setupSchema = z.object({
  login: z.string().trim().min(1).max(64),
  currentPassword: z.string().min(1).max(200),
  pin: z.string().max(20),
});
const developerPinSchema = z.object({
  token: z.string().min(1).max(500),
  pin: z.string().max(20),
  pinConfirm: z.string().max(20),
});

const DEVELOPER_PIN_BOOTSTRAP_KEY = 'developer_pin_bootstrap';

function configuredBootstrapToken(ctx: Ctx): string | null {
  const t = (ctx.config.developerPinBootstrapToken ?? '').trim();
  return t || null;
}

/** Compare two strings without leaking the expected value through a length check. */
function tokenMatches(provided: string, expected: string): boolean {
  return safeEqual(sha256(provided), sha256(expected));
}

export function authRoutes(ctx: Ctx) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: ctx.config.rateLimit.windowMs,
    limit: ctx.config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again.' },
  });

  r.get('/csrf', (req, res) => {
    res.json({ csrfToken: issueCsrf(ctx, res, false, req) });
  });

  r.post('/auth/register', limiter, async (req, res) => {
    const body = parse(registerSchema, req.body);
    const handle = body.handle ?? body.username;
    if (!handle) throw new HttpError(400, 'A handle is required.', 'validation_error');
    const pin = requirePin(body.pin ?? body.password, 'PIN');
    if (await handleTaken(ctx.db, handle)) throw new HttpError(409, 'That handle is taken.', 'conflict');
    if (body.email && (await ctx.db('users').where({ email_lower: body.email }).first())) throw new HttpError(409, 'That email is already used by another account.', 'conflict');
    const id = await insertId(ctx.db('users').insert({
      ...identityColumns(handle),
      email: body.email ?? null,
      email_lower: body.email ?? null,
      password_hash: await hashPassword(pin),
      pin_set: true,
      role: 'PLAYER', // always. Ranks are only granted by authorised staff or the CLI.
      display_name: body.displayName ?? handle,
      created_at: new Date().toISOString(),
    }));
    const user = (await ctx.db<UserRow>('users').where({ id }).first())!;
    await createSession(ctx, req, res, user);
    try {
      if (ctx.config.emailEnabled && user.email) await sendVerificationEmail(ctx, user);
    } catch (e) {
      console.error('verification email failed', e);
    }
    await audit(ctx.db, req, { action: 'auth.register', category: 'auth', targetType: 'user', targetId: user.id, targetLabel: handleOf(user) }, user);
    res.status(201).json({ user: selfUser(user) });
  });

  r.post('/auth/login', limiter, async (req, res) => {
    const body = parse(loginSchema, req.body);
    const submitted = readSubmittedPin(body);
    if (submitted.missing) throw new HttpError(400, 'A PIN is required.', 'validation_error');
    const user = await findUserByHandle(ctx.db, body.login);
    await assertUnlocked(ctx.db, user?.id ?? null, req.ip ?? null);

    // Existing password accounts cannot sign in until they choose a PIN. The old password is not a PIN.
    if (user && !pinIsSet(user)) {
      await audit(ctx.db, req, { action: 'auth.login_blocked_pin_setup', category: 'auth', targetType: 'user', targetId: user.id, targetLabel: handleOf(user) }, user);
      throw new HttpError(403, 'This account needs a PIN. Set one with your current password, or ask a staff member to set one.', 'pin_setup_required');
    }

    const ok = user && submitted.pin ? await verifyPassword(user.password_hash, submitted.pin) : false;
    if (!user || !submitted.pin) await dummyVerify(submitted.pin ?? '0000');
    if (!user || !ok) {
      const { accountLocked, ipLocked } = await recordFailure(ctx.db, user?.id ?? null, req.ip ?? null);
      await audit(ctx.db, req, {
        action: 'auth.login_failed',
        category: 'auth',
        targetType: 'user',
        targetId: user?.id,
        targetLabel: (user ? handleOf(user) : body.login).slice(0, 64),
        details: { locked: accountLocked || ipLocked },
      }, user ?? { id: 0, username: 'unknown', role: 'SYSTEM' });
      if (accountLocked) throw new HttpError(429, 'Too many attempts on this account. Wait 15 minutes and try again.', 'locked');
      if (ipLocked) throw new HttpError(429, 'Too many attempts from this network. Wait 15 minutes and try again.', 'locked');
      throw new HttpError(401, 'Incorrect handle or PIN.', 'bad_credentials');
    }

    await clearAccountFailures(ctx.db, user.id);
    if (user.banned) {
      await audit(ctx.db, req, { action: 'auth.login_blocked_banned', category: 'auth', targetType: 'user', targetId: user.id, targetLabel: handleOf(user) }, user);
      throw new HttpError(403, 'This account is banned.' + (user.ban_reason ? ` Reason: ${user.ban_reason}` : ''), 'banned');
    }
    if (await maintenanceBlocks(ctx.db, user.role)) throw new HttpError(503, 'Batlas is under maintenance. Please try again later.', 'maintenance');
    await ctx.db('users').where({ id: user.id }).update({ last_login_at: new Date().toISOString() });
    await createSession(ctx, req, res, user);
    res.json({ user: selfUser(user) });
  });

  // One-time migration: prove the old password, store a PIN, then sign in. Staff can set a PIN instead.
  r.post('/auth/pin/setup', limiter, async (req, res) => {
    const body = parse(setupSchema, req.body);
    const pin = requirePin(body.pin, 'PIN');
    const user = await findUserByHandle(ctx.db, body.login);
    if (!user) {
      await dummyVerify(body.currentPassword);
      await recordFailure(ctx.db, null, req.ip ?? null);
      await audit(ctx.db, req, { action: 'auth.pin_setup_failed', category: 'auth', targetType: 'user', targetLabel: body.login.slice(0, 64), details: { reason: 'unknown' } }, { id: 0, username: 'unknown', role: 'SYSTEM' });
      throw new HttpError(401, 'Incorrect handle or password.', 'bad_credentials');
    }
    await assertUnlocked(ctx.db, user.id, req.ip ?? null);
    if (pinIsSet(user)) throw new HttpError(400, 'This account already has a PIN. Sign in with it, or ask a staff member to reset it.', 'pin_already_set');
    const ok = await verifyPassword(user.password_hash, body.currentPassword);
    if (!ok) {
      const { accountLocked, ipLocked } = await recordFailure(ctx.db, user.id, req.ip ?? null);
      await audit(ctx.db, req, { action: 'auth.pin_setup_failed', category: 'auth', targetType: 'user', targetId: user.id, targetLabel: handleOf(user), details: { locked: accountLocked || ipLocked } }, user);
      if (accountLocked || ipLocked) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.', 'locked');
      throw new HttpError(401, 'Incorrect handle or password.', 'bad_credentials');
    }
    if (user.banned) throw new HttpError(403, 'This account is banned.' + (user.ban_reason ? ` Reason: ${user.ban_reason}` : ''), 'banned');
    if (await maintenanceBlocks(ctx.db, user.role)) throw new HttpError(503, 'Batlas is under maintenance. Please try again later.', 'maintenance');
    await ctx.db('users').where({ id: user.id }).update({
      password_hash: await hashPassword(pin),
      pin_set: true,
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    });
    await clearAccountFailures(ctx.db, user.id);
    const fresh = (await ctx.db<UserRow>('users').where({ id: user.id }).first())!;
    await createSession(ctx, req, res, fresh);
    await audit(ctx.db, req, { action: 'auth.pin_setup', category: 'auth', targetType: 'user', targetId: fresh.id, targetLabel: handleOf(fresh) }, fresh);
    res.json({ user: selfUser(fresh) });
  });

  // One-time Developer PIN. Exists only while DEVELOPER_PIN_BOOTSTRAP_TOKEN is set.
  // The token and the PIN are never logged. A database flag makes a second success impossible.
  r.post('/auth/developer-pin/bootstrap', limiter, async (req, res) => {
    const expected = configuredBootstrapToken(ctx);
    if (!expected) throw new HttpError(404, 'Not found');
    const body = parse(developerPinSchema, req.body);
    const pin = requirePin(body.pin, 'PIN');
    const confirm = requirePin(body.pinConfirm, 'Confirm PIN');
    const actor = { id: 0, username: 'developer-pin-bootstrap', role: 'SYSTEM' };
    const fail = async (status: number, message: string, code: string, reason: string) => {
      await audit(ctx.db, req, { action: 'auth.developer_pin_bootstrap_failed', category: 'auth', targetType: 'user', targetLabel: 'developer', details: { reason } }, actor);
      throw new HttpError(status, message, code);
    };
    if (!tokenMatches(body.token, expected)) await fail(401, 'That setup token was not accepted.', 'bad_token', 'bad_token');
    if (pin !== confirm) await fail(400, 'The PINs do not match.', 'mismatch', 'mismatch');

    const devId = await ctx.db.transaction(async (trx) => {
      const used = await trx('site_settings').where({ key: DEVELOPER_PIN_BOOTSTRAP_KEY }).first();
      if (used) throw new HttpError(409, 'This setup was already used.', 'already_used');
      const dev = await trx<UserRow>('users').where({ role: 'DEVELOPER' }).orderBy('id', 'asc').first();
      if (!dev) throw new HttpError(404, 'No Developer account to update.', 'not_found');
      const now = new Date().toISOString();
      const n = await trx('users').where({ id: dev.id, role: 'DEVELOPER' }).update({
        password_hash: await hashPassword(pin),
        pin_set: true,
        must_change_password: false,
        password_changed_at: now,
      });
      if (n !== 1) throw new HttpError(409, 'The Developer account could not be updated.', 'conflict');
      await trx('sessions').where({ user_id: dev.id }).delete();
      await trx('game_tokens').where({ user_id: dev.id }).delete();
      try {
        await trx('site_settings').insert({
          key: DEVELOPER_PIN_BOOTSTRAP_KEY,
          value: JSON.stringify({ used: true, userId: dev.id }),
          updated_by: dev.id,
          updated_at: now,
        });
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(409, 'This setup was already used.', 'already_used');
      }
      return dev.id;
    });

    await audit(ctx.db, req, { action: 'auth.developer_pin_bootstrap', category: 'auth', targetType: 'user', targetId: devId, targetLabel: 'developer' }, actor);
    res.json({ ok: true });
  });

  r.post('/auth/logout', async (req, res) => {
    await destroySession(ctx, req, res);
    res.json({ ok: true });
  });

  return r;
}
