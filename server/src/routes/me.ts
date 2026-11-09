import { Router } from 'express';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { selfUser, publicUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requireAuth } from '../lib/session.js';
import { permissionsFor } from '../lib/permissions.js';

const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    bio: z.string().trim().max(500).optional(),
  })
  .strict(); // reject attempts to sneak in role/banned/etc.

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

  r.get('/users/:username', async (req, res) => {
    const u = await ctx.db<UserRow>('users').where({ username_lower: String(req.params.username).toLowerCase() }).first();
    if (!u) throw new HttpError(404, 'Player not found');
    res.json({ user: { ...publicUser(u), banned: !!u.banned } });
  });

  return r;
}
