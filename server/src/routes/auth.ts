import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { selfUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword, dummyVerify } from '../lib/crypto.js';
import { createSession, destroySession, issueCsrf } from '../lib/session.js';
import { audit } from '../lib/audit.js';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_]+$/, 'letters, numbers and underscore only');
export const passwordSchema = z.string().min(10, 'must be at least 10 characters').max(200);

// .strict() is NOT used on purpose: unknown fields such as `role` are silently dropped,
// so a client can never pick its own rank.
const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
});
const loginSchema = z.object({
  login: z.string().trim().min(1).max(254), // username or email
  password: z.string().min(1).max(200),
});

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
    const exists = await ctx
      .db('users')
      .where({ username_lower: body.username.toLowerCase() })
      .orWhere({ email_lower: body.email.toLowerCase() })
      .first();
    if (exists) throw new HttpError(409, 'That username or email is already registered.', 'conflict');
    const [id] = await ctx.db('users').insert({
      username: body.username,
      username_lower: body.username.toLowerCase(),
      email: body.email,
      email_lower: body.email.toLowerCase(),
      password_hash: await hashPassword(body.password),
      role: 'PLAYER', // always. Ranks are only granted by authorised staff or the CLI.
      display_name: body.username,
      created_at: new Date().toISOString(),
    });
    const user = (await ctx.db<UserRow>('users').where({ id }).first())!;
    await createSession(ctx, req, res, user);
    await audit(ctx.db, req, { action: 'auth.register', category: 'auth', targetType: 'user', targetId: user.id, targetLabel: user.username }, user);
    res.status(201).json({ user: selfUser(user) });
  });

  r.post('/auth/login', limiter, async (req, res) => {
    const body = parse(loginSchema, req.body);
    const l = body.login.toLowerCase();
    const user = await ctx.db<UserRow>('users').where({ username_lower: l }).orWhere({ email_lower: l }).first();
    const ok = user ? await verifyPassword(user.password_hash, body.password) : await dummyVerify(body.password);
    if (!user || !ok) throw new HttpError(401, 'Incorrect username/email or password.', 'bad_credentials');
    if (user.banned) {
      await audit(ctx.db, req, { action: 'auth.login_blocked_banned', category: 'auth', targetType: 'user', targetId: user.id, targetLabel: user.username }, user);
      throw new HttpError(403, 'This account is banned.' + (user.ban_reason ? ` Reason: ${user.ban_reason}` : ''), 'banned');
    }
    await ctx.db('users').where({ id: user.id }).update({ last_login_at: new Date().toISOString() });
    await createSession(ctx, req, res, user);
    res.json({ user: selfUser(user) });
  });

  r.post('/auth/logout', async (req, res) => {
    await destroySession(ctx, req, res);
    res.json({ ok: true });
  });

  return r;
}
