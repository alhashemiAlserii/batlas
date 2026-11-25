import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Ctx, UserRow } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { canActOn } from '../lib/permissions.js';
import { findUserByHandle, handleOf } from '../lib/identity.js';
import { insertId } from '../db/index.js';
import { guard } from './admin.js';
import { passActive, type PassKind } from '../lib/passes.js';

const KINDS = ['early_access', 'crew'] as const;

function when(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new HttpError(400, 'Expiry must be a date.');
  return new Date(t).toISOString();
}

async function passOut(db: Ctx['db'], row: any) {
  const game = row.game_id ? await db('games').where({ id: row.game_id }).first('slug', 'title') : null;
  return {
    id: row.id,
    kind: row.kind as PassKind,
    gameSlug: game?.slug ?? null,
    gameTitle: game?.title ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    note: row.note ?? '',
    createdAt: row.created_at,
    active: passActive(row),
  };
}

export function passesRoutes(ctx: Ctx) {
  const r = Router();
  const grant = requirePermission('passes.grant');

  r.get('/passes/mine', async (req, res) => {
    if (!req.user) return res.json({ signedIn: false, passes: [] });
    const rows = await ctx.db('passes').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(50);
    const passes = [];
    for (const row of rows) passes.push(await passOut(ctx.db, row));
    res.json({ signedIn: true, handle: handleOf(req.user), passes });
  });

  r.get('/admin/passes', grant, async (_req, res) => {
    const rows = await ctx.db('passes as p')
      .leftJoin('users as u', 'u.id', 'p.user_id')
      .orderBy('p.id', 'desc')
      .limit(200)
      .select('p.*', 'u.handle', 'u.username', 'u.display_name', 'u.role');
    const passes = [];
    for (const row of rows) {
      passes.push({
        ...(await passOut(ctx.db, row)),
        handle: row.handle || row.username || '',
        displayName: row.display_name || row.handle || row.username || '',
        role: row.role ?? null,
      });
    }
    res.json({ passes });
  });

  r.post('/admin/passes', grant, async (req, res) => {
    const b = parse(z.object({
      handle: z.string().trim().min(1).max(32),
      kind: z.enum(KINDS),
      gameSlug: z.string().trim().toLowerCase().max(64).optional(),
      expiresAt: z.string().trim().max(40).nullable().optional(),
      note: z.string().trim().max(200).optional(),
    }).strict(), req.body);
    const target = await findUserByHandle(ctx.db, b.handle);
    if (!target) throw new HttpError(404, 'No player with that handle.');
    await guard(ctx, req, target, 'pass.grant');
    let gameId: number | null = null;
    if (b.gameSlug) {
      const g = await ctx.db('games').where({ slug: b.gameSlug }).first('id', 'title');
      if (!g) throw new HttpError(400, 'Unknown game.');
      gameId = g.id;
    }
    const expiresAt = when(b.expiresAt);
    const now = new Date().toISOString();
    const id = await insertId(ctx.db('passes').insert({
      user_id: target.id,
      kind: b.kind,
      game_id: gameId,
      expires_at: expiresAt,
      revoked_at: null,
      granted_by: req.user!.id,
      note: b.note || null,
      created_at: now,
    }));
    await audit(ctx.db, req, {
      action: 'pass.grant',
      category: 'admin',
      targetType: 'user',
      targetId: target.id,
      targetLabel: handleOf(target),
      details: { passId: id, kind: b.kind, gameSlug: b.gameSlug || null, expiresAt },
    });
    const row = await ctx.db('passes').where({ id }).first();
    res.status(201).json({ pass: await passOut(ctx.db, row) });
  });

  r.delete('/admin/passes/:id', grant, async (req, res) => {
    const id = Number(req.params.id);
    const row = await ctx.db('passes').where({ id }).first();
    if (!row) throw new HttpError(404, 'Pass not found.');
    const target = await ctx.db<UserRow>('users').where({ id: row.user_id }).first();
    if (!target) throw new HttpError(404, 'Player not found.');
    await guard(ctx, req, target, 'pass.revoke');
    if (row.revoked_at) return res.json({ ok: true, pass: await passOut(ctx.db, row) });
    const revokedAt = new Date().toISOString();
    await ctx.db('passes').where({ id }).update({ revoked_at: revokedAt });
    await audit(ctx.db, req, {
      action: 'pass.revoke',
      category: 'admin',
      targetType: 'user',
      targetId: target.id,
      targetLabel: handleOf(target),
      details: { passId: id, kind: row.kind },
    });
    res.json({ ok: true, pass: await passOut(ctx.db, { ...row, revoked_at: revokedAt }) });
  });

  const limiter = rateLimit({
    windowMs: ctx.config.contactRateLimit.windowMs,
    limit: ctx.config.contactRateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Please wait a moment before sending more feedback.' },
  });

  r.post('/feedback', limiter, async (req, res) => {
    const b = parse(z.object({
      message: z.string().trim().min(4, 'Tell us a little more.').max(2000),
      page: z.string().trim().max(200).optional(),
      company: z.string().max(200).optional(),
    }).strict(), req.body);
    if (b.company && b.company.trim() !== '') return res.status(201).json({ ok: true });
    await ctx.db('feedback').insert({
      user_id: req.user?.id ?? null,
      handle: req.user ? handleOf(req.user) : null,
      page: (b.page || '').slice(0, 200) || null,
      message: b.message,
      created_at: new Date().toISOString(),
    });
    res.status(201).json({ ok: true });
  });

  r.get('/admin/feedback', requirePermission('admin.panel'), async (_req, res) => {
    const rows = await ctx.db('feedback').orderBy('id', 'desc').limit(200);
    res.json({
      feedback: rows.map((m: any) => ({
        id: m.id,
        handle: m.handle || '',
        page: m.page || '',
        message: m.message,
        createdAt: m.created_at,
      })),
    });
  });

  return r;
}
