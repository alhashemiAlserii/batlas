import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { selfUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requireAuth, createSession } from '../lib/session.js';
import { hashPassword, verifyPassword, randomToken } from '../lib/crypto.js';
import { issueToken, consumeToken } from '../lib/tokens.js';
import { audit } from '../lib/audit.js';
import { passwordSchema, optionalEmail } from '../lib/schemas.js';
import { IMAGE_TYPES } from './games.js';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export async function sendVerificationEmail(ctx: Ctx, user: UserRow) {
  if (!user.email) return;
  const token = await issueToken(ctx, user.id, 'verify_email', user.email);
  await ctx.mailer.send({
    to: user.email,
    subject: 'Confirm your Batlas account email',
    text: `Hi ${user.username},\n\nConfirm your email address for your Batlas account:\n${ctx.config.publicUrl}/verify-email?token=${token}\n\nThis link expires in 24 hours. If you didn't create a Batlas account, you can ignore this email.\n\n— Batlas`,
  });
}

/** Ends every website session and game token for a user (after password change/reset). */
async function revokeAllSessions(ctx: Ctx, userId: number) {
  await ctx.db('sessions').where({ user_id: userId }).delete();
  await ctx.db('game_tokens').where({ user_id: userId }).delete();
}

export function accountRoutes(ctx: Ctx) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: ctx.config.rateLimit.windowMs,
    limit: ctx.config.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait and try again.' },
  });
  const tokenSchema = z.object({ token: z.string().min(20).max(200) });
  /** Email features are switched off unless EMAIL_ENABLED=true (email is optional for players). */
  const emailOn: import('express').RequestHandler = (_req, _res, next) => (ctx.config.emailEnabled ? next() : next(new HttpError(404, 'Email features are turned off on this site.', 'email_disabled')));

  // ---- email verification ----
  r.post('/auth/verify-email/request', requireAuth, limiter, emailOn, async (req, res) => {
    const u = req.user!;
    if (!u.email) throw new HttpError(400, 'Add an email address first.');
    if (u.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
    await sendVerificationEmail(ctx, u);
    res.json({ ok: true });
  });

  r.post('/auth/verify-email/confirm', limiter, emailOn, async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const row = await consumeToken(ctx, token, 'verify_email');
    if (!row) throw new HttpError(400, 'This link is invalid, expired or already used.', 'invalid_token');
    const u = await ctx.db<UserRow>('users').where({ id: row.user_id }).first();
    if (!u || !u.email_lower || u.email_lower !== String(row.email).toLowerCase()) throw new HttpError(400, 'This link is no longer valid for this account.', 'invalid_token');
    await ctx.db('users').where({ id: u.id }).update({ email_verified_at: new Date().toISOString() });
    await audit(ctx.db, req, { action: 'auth.email_verified', category: 'auth', targetType: 'user', targetId: u.id, targetLabel: u.username }, u);
    res.json({ ok: true });
  });

  // ---- password reset (no account enumeration: always the same answer) ----
  r.post('/auth/password/forgot', limiter, emailOn, async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254) }), req.body);
    const u = await ctx.db<UserRow>('users').where({ email_lower: email }).first();
    if (u && !u.banned && u.email) {
      const token = await issueToken(ctx, u.id, 'reset_password', u.email!);
      await ctx.mailer.send({
        to: u.email!,
        subject: 'Reset your Batlas password',
        text: `Hi ${u.username},\n\nSomeone (hopefully you) asked to reset your Batlas password. Choose a new one here:\n${ctx.config.publicUrl}/reset-password?token=${token}\n\nThis link expires in 1 hour and can only be used once. If you didn't ask for this, ignore this email; your password stays the same.\n\n— Batlas`,
      });
      await audit(ctx.db, req, { action: 'auth.password_reset_requested', category: 'auth', targetType: 'user', targetId: u.id, targetLabel: u.username }, u);
    }
    res.json({ ok: true, message: 'If an account uses that email, a reset link has been sent.' });
  });

  r.post('/auth/password/reset', limiter, emailOn, async (req, res) => {
    const body = parse(tokenSchema.extend({ password: passwordSchema }), req.body);
    const row = await consumeToken(ctx, body.token, 'reset_password');
    if (!row) throw new HttpError(400, 'This reset link is invalid, expired or already used.', 'invalid_token');
    const u = await ctx.db<UserRow>('users').where({ id: row.user_id }).first();
    if (!u || u.banned) throw new HttpError(400, 'This reset link is no longer valid.', 'invalid_token');
    await ctx.db('users').where({ id: u.id }).update({ password_hash: await hashPassword(body.password), password_changed_at: new Date().toISOString(), must_change_password: false });
    await revokeAllSessions(ctx, u.id);
    // The reset link proves control of the email address.
    if (!u.email_verified_at && u.email_lower && u.email_lower === String(row.email).toLowerCase()) await ctx.db('users').where({ id: u.id }).update({ email_verified_at: new Date().toISOString() });
    await audit(ctx.db, req, { action: 'auth.password_reset', category: 'auth', targetType: 'user', targetId: u.id, targetLabel: u.username }, u);
    res.json({ ok: true });
  });

  // ---- change password (logged in) ----
  r.post('/me/password', requireAuth, limiter, async (req, res) => {
    const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }), req.body);
    const u = req.user!;
    if (!(await verifyPassword(u.password_hash, body.currentPassword))) throw new HttpError(403, 'Your current password is incorrect.', 'bad_credentials');
    if (body.currentPassword === body.newPassword) throw new HttpError(400, 'Choose a password different from your current one.');
    await ctx.db('users').where({ id: u.id }).update({ password_hash: await hashPassword(body.newPassword), password_changed_at: new Date().toISOString(), must_change_password: false });
    await revokeAllSessions(ctx, u.id); // logs out every device...
    await createSession(ctx, req, res, u); // ...then keeps this one signed in with a fresh session
    await audit(ctx.db, req, { action: 'auth.password_change', category: 'auth', targetType: 'user', targetId: u.id, targetLabel: u.username });
    res.json({ ok: true });
  });

  // ---- optional email: add / change / remove (needs current password) ----
  r.post('/me/email', requireAuth, limiter, async (req, res) => {
    const body = parse(z.object({ email: optionalEmail, currentPassword: z.string().min(1).max(200) }), req.body);
    const u = req.user!;
    if (!(await verifyPassword(u.password_hash, body.currentPassword))) throw new HttpError(403, 'Your current password is incorrect.', 'bad_credentials');
    const email = body.email ?? null;
    if (email && (await ctx.db('users').where({ email_lower: email }).whereNot({ id: u.id }).first())) throw new HttpError(409, 'That email is already used by another account.', 'conflict');
    const changed = (u.email_lower ?? null) !== email;
    await ctx.db('users').where({ id: u.id }).update({ email, email_lower: email, ...(changed ? { email_verified_at: null } : {}) });
    if (changed) await ctx.db('auth_tokens').where({ user_id: u.id }).whereNull('used_at').update({ used_at: new Date().toISOString() });
    const nu = (await ctx.db<UserRow>('users').where({ id: u.id }).first())!;
    if (changed && email && ctx.config.emailEnabled) await sendVerificationEmail(ctx, nu).catch(() => {});
    res.json({ user: selfUser(nu) });
  });

  // ---- avatars ----
  const avatarDir = path.join(ctx.config.uploadDir, 'avatars');
  fs.mkdirSync(avatarDir, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });
  const removeOld = async (url: string | null) => {
    if (!url?.startsWith('/uploads/avatars/')) return;
    await fs.promises.unlink(path.join(avatarDir, path.basename(url))).catch(() => {});
  };

  r.post('/me/avatar', requireAuth, upload.single('file'), async (req, res) => {
    const f = req.file;
    if (!f) throw new HttpError(400, 'Upload a PNG, JPEG, WebP or GIF image as "file".');
    const t = IMAGE_TYPES[f.mimetype];
    if (!t || !t.magic(f.buffer)) throw new HttpError(400, 'That file is not a supported image (PNG, JPEG, WebP or GIF).', 'bad_image');
    let out: Buffer;
    try {
      // Re-encode: fixes orientation, crops to a square, and strips all metadata (EXIF/GPS).
      out = await sharp(f.buffer, { limitInputPixels: 40_000_000, animated: false })
        .rotate()
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'That image could not be read.', 'bad_image');
    }
    const name = `${req.user!.id}-${randomToken(9)}.webp`;
    await fs.promises.writeFile(path.join(avatarDir, name), out, { flag: 'wx' });
    await removeOld(req.user!.avatar_url);
    const url = `/uploads/avatars/${name}`;
    await ctx.db('users').where({ id: req.user!.id }).update({ avatar_url: url });
    const u = (await ctx.db<UserRow>('users').where({ id: req.user!.id }).first())!;
    res.status(201).json({ user: selfUser(u) });
  });

  r.delete('/me/avatar', requireAuth, async (req, res) => {
    await removeOld(req.user!.avatar_url);
    await ctx.db('users').where({ id: req.user!.id }).update({ avatar_url: null });
    res.json({ ok: true });
  });

  return r;
}
