import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { adminUser } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requirePermission } from '../lib/session.js';
import { canActOn, hasPermission, isRole, permissionToAssign, ROLES, type Role } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';
import { verifyPassword, hashPassword } from '../lib/crypto.js';
import crypto from 'node:crypto';

const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });
const roleSchema = z.object({
  role: z.enum(ROLES),
  confirmPin: z.string().max(200).optional(),
  confirmPassword: z.string().max(200).optional(),
});

export async function loadTarget(ctx: Ctx, req: Request): Promise<UserRow> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid user id');
  const t = await ctx.db<UserRow>('users').where({ id }).first();
  if (!t) throw new HttpError(404, 'User not found');
  return t;
}

/** Runs canActOn and audit-logs denied attempts so abuse is visible. */
export async function guard(ctx: Ctx, req: Request, target: UserRow, action: string) {
  const actor = req.user!;
  const g = canActOn({ id: actor.id, role: actor.role }, { id: target.id, role: target.role });
  if (!g.ok) {
    await audit(ctx.db, req, {
      action: `${action}.denied`,
      category: action.startsWith('role') ? 'roles' : 'moderation',
      targetType: 'user',
      targetId: target.id,
      targetLabel: target.username,
      details: { reason: g.reason, targetRole: target.role },
    });
    throw new HttpError(403, g.reason, 'protected');
  }
}

export const MODERATION_ACTIONS = ['player.ban', 'player.unban', 'player.kick', 'player.password_reset', 'player.delete'];

export function adminRoutes(ctx: Ctx) {
  const r = Router();

  r.get('/admin/users', requirePermission('players.view'), async (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 64);
    const role = String(req.query.role ?? '');
    let query = ctx.db<UserRow>('users').orderBy('id', 'asc').limit(200);
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
      query = query.where((b) =>
        b.whereRaw("username_lower LIKE ? ESCAPE '\\'", [like])
          .orWhereRaw("coalesce(handle_lower, '') LIKE ? ESCAPE '\\'", [like])
          .orWhereRaw("lower(coalesce(display_name, '')) LIKE ? ESCAPE '\\'", [like])
          .orWhereRaw("coalesce(email_lower, '') LIKE ? ESCAPE '\\'", [like]));
    }
    if (isRole(role)) query = query.andWhere({ role });
    const users = await query;
    const online = await ctx.db('sessions').where('expires_at', '>', new Date().toISOString()).countDistinct({ n: 'user_id' }).first();
    res.json({ users: users.map(adminUser), total: users.length, activeSessions: Number(online?.n ?? 0) });
  });

  r.post('/admin/users/:id/ban', requirePermission('players.ban'), async (req, res) => {
    const { reason } = parse(reasonSchema, req.body ?? {});
    const target = await loadTarget(ctx, req);
    await guard(ctx, req, target, 'player.ban');
    await ctx.db.transaction(async (trx) => {
      await trx('users').where({ id: target.id }).update({ banned: true, ban_reason: reason ?? null, banned_at: new Date().toISOString() });
      await trx('sessions').where({ user_id: target.id }).delete(); // log them out everywhere
      await trx('game_tokens').where({ user_id: target.id }).delete();
    });
    await audit(ctx.db, req, { action: 'player.ban', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { reason: reason ?? null } });
    res.json({ ok: true, user: adminUser((await ctx.db<UserRow>('users').where({ id: target.id }).first())!) });
  });

  r.post('/admin/users/:id/unban', requirePermission('players.ban'), async (req, res) => {
    const target = await loadTarget(ctx, req);
    await guard(ctx, req, target, 'player.unban');
    await ctx.db('users').where({ id: target.id }).update({ banned: false, ban_reason: null, banned_at: null });
    await audit(ctx.db, req, { action: 'player.unban', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username });
    res.json({ ok: true });
  });

  // Stage 1: a kick is recorded as a moderation action and ends the player's game tokens.
  // Stage 4 will also disconnect them from live game servers.
  r.post('/admin/users/:id/kick', requirePermission('players.kick'), async (req, res) => {
    const { reason } = parse(reasonSchema, req.body ?? {});
    const target = await loadTarget(ctx, req);
    await guard(ctx, req, target, 'player.kick');
    await ctx.db('game_tokens').where({ user_id: target.id }).delete();
    await audit(ctx.db, req, { action: 'player.kick', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { reason: reason ?? null } });
    res.json({ ok: true });
  });

  // Staff PIN reset (email is optional, so this is how a forgotten PIN is replaced).
  // Issues a one-time temporary PIN, signs the player out everywhere and forces a new
  // PIN at next login. canActOn: Admins only for Players/Trusted; nobody can reset a Developer.
  // The PIN is returned once in this response and is never written to the audit log.
  const resetPin = async (req: Request, res: import('express').Response) => {
    const target = await loadTarget(ctx, req);
    await guard(ctx, req, target, 'player.password_reset');
    const temp = tempPin();
    await ctx.db.transaction(async (trx) => {
      await trx('users').where({ id: target.id }).update({ password_hash: await hashPassword(temp), pin_set: true, must_change_password: true, password_changed_at: new Date().toISOString() });
      await trx('sessions').where({ user_id: target.id }).delete();
      await trx('game_tokens').where({ user_id: target.id }).delete();
      await trx('auth_tokens').where({ user_id: target.id }).whereNull('used_at').update({ used_at: new Date().toISOString() });
    });
    await audit(ctx.db, req, { action: 'player.password_reset', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username });
    res.json({ ok: true, temporaryPin: temp, temporaryPassword: temp, note: 'Give this PIN to the player privately. It works once; they must choose a new PIN after signing in.' });
  };
  r.post('/admin/users/:id/temp-password', requirePermission('players.reset_password'), resetPin);
  r.post('/admin/users/:id/reset-pin', requirePermission('players.reset_password'), resetPin);

  // Permanently delete an account. Developer only (players.delete), never a Developer, never yourself.
  // The client must echo the exact username as confirmation.
  r.delete('/admin/users/:id', requirePermission('players.delete'), async (req, res) => {
    const target = await loadTarget(ctx, req);
    const { confirm } = parse(z.object({ confirm: z.string().max(64) }), req.body ?? {});
    const actor = req.user!;
    const refuse = target.id === actor.id ? 'You cannot delete your own account here.' : target.role === 'DEVELOPER' ? 'Developer accounts cannot be deleted.' : null;
    if (refuse) {
      await audit(ctx.db, req, { action: 'player.delete.denied', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { reason: refuse, targetRole: target.role } });
      throw new HttpError(403, refuse, 'protected');
    }
    // The client must echo the exact handle as confirmation.
    if (confirm !== target.username && confirm !== (target.handle || target.username)) throw new HttpError(400, `Type the handle "${target.handle || target.username}" to confirm.`, 'confirm_required');
    const removed: Record<string, number> = {};
    await ctx.db.transaction(async (trx) => {
      for (const t of ['sessions', 'game_tokens', 'auth_tokens', 'game_flights']) removed[t] = await trx(t).where({ user_id: target.id }).delete();
      removed.avatars = await trx('media').where({ uploaded_by: target.id, kind: 'avatar' }).delete();
      removed.news_posts_unlinked = await trx('news_posts').where({ author_id: target.id }).update({ author_id: null });
      const n = await trx('users').where({ id: target.id }).andWhereNot({ role: 'DEVELOPER' }).delete();
      if (n !== 1) throw new HttpError(409, 'Account changed while deleting; nothing was deleted.');
    });
    await audit(ctx.db, req, { action: 'player.delete', category: 'moderation', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { role: target.role, removed } });
    res.json({ ok: true, deleted: { id: target.id, username: target.username }, removed });
  });

  r.put('/admin/users/:id/role', async (req, res) => {
    const actor = req.user;
    if (!actor) throw new HttpError(401, 'Login required');
    const anyGrant = (['roles.grant.trusted', 'roles.grant.admin', 'roles.grant.developer'] as const).some((p) => hasPermission(actor.role, p));
    if (!anyGrant) throw new HttpError(403, 'You do not have permission to do that.', 'forbidden');

    const body = parse(roleSchema, req.body);
    const target = await loadTarget(ctx, req);
    await guard(ctx, req, target, 'role.change');

    const newRole = body.role as Role;
    const needNew = permissionToAssign(newRole);
    const needOld = permissionToAssign(target.role);
    for (const need of [needNew, needOld]) {
      if (need && !hasPermission(actor.role, need)) {
        await audit(ctx.db, req, { action: 'role.change.denied', category: 'roles', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { from: target.role, to: newRole, missing: need } });
        throw new HttpError(403, `Only a rank with "${need}" can make that change.`, 'forbidden');
      }
    }
    if (newRole === 'DEVELOPER') {
      // Granting ownership-level access needs the Developer to re-confirm their PIN.
      const secret = body.confirmPin ?? body.confirmPassword ?? '';
      const ok = secret ? await verifyPassword(actor.password_hash, secret) : false;
      if (!ok) throw new HttpError(403, 'Re-enter your PIN to grant Developer status.', 'reauth_required');
    }
    if (newRole === target.role) return res.json({ ok: true, unchanged: true });
    await ctx.db('users').where({ id: target.id }).update({ role: newRole });
    await audit(ctx.db, req, { action: 'role.change', category: 'roles', targetType: 'user', targetId: target.id, targetLabel: target.username, details: { from: target.role, to: newRole } });
    res.json({ ok: true, user: adminUser((await ctx.db<UserRow>('users').where({ id: target.id }).first())!) });
  });

  r.get('/admin/moderation', requirePermission('moderation.view'), async (req, res) => {
    const rows = await ctx.db('audit_logs').where({ category: 'moderation' }).orderBy('id', 'desc').limit(200);
    res.json({ entries: rows.map(fmt) });
  });

  r.get('/admin/audit', requirePermission('audit.view'), async (req, res) => {
    const category = String(req.query.category ?? '');
    let q = ctx.db('audit_logs').orderBy('id', 'desc').limit(500);
    if (category) q = q.where({ category });
    res.json({ entries: (await q).map(fmt) });
  });

  return r;
}

function fmt(r: any) {
  return {
    id: r.id,
    actor: r.actor_username,
    actorRole: r.actor_role,
    action: r.action,
    category: r.category,
    targetType: r.target_type,
    targetId: r.target_id,
    target: r.target_label,
    details: r.details ? JSON.parse(r.details) : null,
    createdAt: r.created_at,
  };
}

/** 6 digit PIN, shown once to staff and never written to a log. */
function tempPin() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}
