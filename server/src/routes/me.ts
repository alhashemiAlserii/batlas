import { Router } from 'express';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { selfUser, publicUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requireAuth } from '../lib/session.js';
import { permissionsFor } from '../lib/permissions.js';
import { displayNameSchema, handleSchema } from '../lib/schemas.js';
import { findUserByHandle, handleOf, handleTaken, identityColumns, pinIsSet, requirePin } from '../lib/identity.js';
import { verifyPassword } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';

const profileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: z.string().trim().max(500).optional(),
  })
  .strict(); // reject attempts to sneak in role/banned/etc.

const handleChangeSchema = z.object({
  handle: z.string().trim().min(1).max(32),
  pin: z.string().max(200).optional(),
  password: z.string().max(200).optional(),
}).strict();

export function meRoutes(ctx: Ctx) {
  const r = Router();

  r.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: selfUser(req.user) });
  });

  r.get('/me/permissions', (req, res) => {
    if (!req.user) return res.json({ role: null, permissions: [] });
    res.json({ role: req.user.role, permissions: permissionsFor(req.user.role) });
  });

  r.patch('/me', requireAuth, async (req, res) => {
    const body = parse(profileSchema, req.body);
    const update: Record<string, unknown> = {};
    if (body.displayName !== undefined) update.display_name = body.displayName;
    if (body.bio !== undefined) update.bio = body.bio;
    if (Object.keys(update).length) await ctx.db('users').where({ id: req.user!.id }).update(update);
    const u = (await ctx.db<UserRow>('users').where({ id: req.user!.id }).first())!;
    res.json({ user: selfUser(u) });
  });

  // Handles are changeable. Uniqueness is case-insensitive and checked here, not in the browser.
  // The Developer stays the Developer because that is the user id and rank, not the handle string.
  r.patch('/me/handle', requireAuth, async (req, res) => {
    const body = parse(handleChangeSchema, req.body);
    const handle = parse(handleSchema, body.handle);
    const pin = requirePin(body.pin ?? body.password, 'PIN');
    const u = req.user!;
    if (!pinIsSet(u) || !(await verifyPassword(u.password_hash, pin))) throw new HttpError(403, 'Your PIN is incorrect.', 'bad_credentials');
    if (handle.toLowerCase() !== handleOf(u).toLowerCase() && (await handleTaken(ctx.db, handle, u.id))) {
      throw new HttpError(409, 'That handle is taken.', 'conflict');
    }
    if (handle !== handleOf(u)) {
      await ctx.db('users').where({ id: u.id }).update(identityColumns(handle));
      await audit(ctx.db, req, { action: 'auth.handle_change', category: 'auth', targetType: 'user', targetId: u.id, targetLabel: handle, details: { from: handleOf(u) } });
    }
    const fresh = (await ctx.db<UserRow>('users').where({ id: u.id }).first())!;
    res.json({ user: selfUser(fresh) });
  });

  r.get('/users/:username', async (req, res) => {
    const u = await findUserByHandle(ctx.db, String(req.params.username));
    if (!u) throw new HttpError(404, 'Player not found');
    res.json({ user: { ...publicUser(u), banned: !!u.banned } });
  });

  return r;
}
