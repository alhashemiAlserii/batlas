import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Ctx } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';
import { optionalEmail } from '../lib/schemas.js';

const contactSchema = z.object({
  name: z.string().trim().min(1, 'required').max(80),
  email: optionalEmail, // optional: players on school devices may not have one
  subject: z.string().trim().min(1, 'required').max(160),
  message: z.string().trim().min(10, 'must be at least 10 characters').max(5000),
  website: z.string().max(500).optional(), // honeypot: real people never see or fill this
});

export function contactRoutes(ctx: Ctx) {
  const r = Router();
  const limiter = rateLimit({
    windowMs: ctx.config.contactRateLimit.windowMs,
    limit: ctx.config.contactRateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'You have sent several messages recently. Please try again later.' },
  });

  r.post('/contact', limiter, async (req, res) => {
    const b = parse(contactSchema, req.body);
    // Bots that fill the hidden field get the same success response, but nothing is stored.
    if (b.website && b.website.trim() !== '') return res.status(201).json({ ok: true });
    await ctx.db('contact_messages').insert({
      name: b.name,
      email: b.email ?? '',
      subject: b.subject,
      message: b.message,
      status: 'new',
      user_id: req.user?.id ?? null,
      ip: req.ip ?? null,
      created_at: new Date().toISOString(),
    });
    res.status(201).json({ ok: true });
  });

  const can = requirePermission('inbox.view');

  r.get('/dev/inbox', can, async (req, res) => {
    const status = String(req.query.status ?? '');
    let q = ctx.db('contact_messages').orderBy('id', 'desc').limit(500);
    if (['new', 'read', 'archived'].includes(status)) q = q.where({ status });
    else q = q.whereNot({ status: 'archived' });
    const counts = await ctx.db('contact_messages').select('status').count({ n: '*' }).groupBy('status');
    res.json({
      messages: (await q).map((m: any) => ({ id: m.id, name: m.name, email: m.email, subject: m.subject, message: m.message, status: m.status, createdAt: m.created_at })),
      counts: Object.fromEntries(counts.map((c: any) => [c.status, Number(c.n)])),
    });
  });

  r.patch('/dev/inbox/:id', can, async (req, res) => {
    const id = Number(req.params.id);
    const { status } = parse(z.object({ status: z.enum(['new', 'read', 'archived']) }), req.body);
    const m = await ctx.db('contact_messages').where({ id }).first();
    if (!m) throw new HttpError(404, 'Message not found');
    await ctx.db('contact_messages').where({ id }).update({ status });
    await audit(ctx.db, req, { action: `inbox.${status}`, category: 'admin', targetType: 'message', targetId: id, targetLabel: m.subject.slice(0, 120) });
    res.json({ ok: true });
  });

  return r;
}
