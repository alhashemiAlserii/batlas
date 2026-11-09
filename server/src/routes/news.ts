import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../lib/types.js';
import { parse, HttpError } from '../lib/http.js';
import { requirePermission } from '../lib/session.js';
import { audit } from '../lib/audit.js';

const imgUrl = z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\//i.test(v) || v.startsWith('/'), 'must be an http(s) URL or site path');
const postSchema = z.object({
  slug: z.string().trim().toLowerCase().min(2).max(80).regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers and dashes'),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(300).optional(),
  body: z.string().max(50000).optional(),
  coverImage: imgUrl.optional(),
  status: z.enum(['draft', 'published']).optional(),
  pinned: z.boolean().optional(),
});

function toRow(b: Partial<z.infer<typeof postSchema>>) {
  const row: Record<string, unknown> = {};
  if (b.slug !== undefined) row.slug = b.slug;
  if (b.title !== undefined) row.title = b.title;
  if (b.summary !== undefined) row.summary = b.summary;
  if (b.body !== undefined) row.body = b.body;
  if (b.coverImage !== undefined) row.cover_image = b.coverImage;
  if (b.status !== undefined) row.status = b.status;
  if (b.pinned !== undefined) row.pinned = b.pinned;
  return row;
}

function out(p: any, includeBody = true) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    summary: p.summary ?? '',
    ...(includeBody ? { body: p.body ?? '' } : {}),
    coverImage: p.cover_image ?? '',
    status: p.status,
    pinned: !!p.pinned,
    author: p.author_username ? { username: p.author_username, displayName: p.author_display ?? p.author_username, role: p.author_role, avatarUrl: p.author_avatar ?? '' } : null,
    publishedAt: p.published_at,
    updatedAt: p.updated_at,
  };
}

export function newsRoutes(ctx: Ctx) {
  const r = Router();
  const base = () =>
    ctx
      .db('news_posts as n')
      .leftJoin('users as u', 'u.id', 'n.author_id')
      .select('n.*', 'u.username as author_username', 'u.display_name as author_display', 'u.role as author_role', 'u.avatar_url as author_avatar');

  // ---- public ----
  r.get('/news', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const rows = await base().where('n.status', 'published').orderBy([{ column: 'n.pinned', order: 'desc' }, { column: 'n.published_at', order: 'desc' }]).limit(limit);
    res.json({ posts: rows.map((p) => out(p, false)) });
  });

  r.get('/news/:slug', async (req, res) => {
    const p = await base().where('n.slug', String(req.params.slug).toLowerCase()).andWhere('n.status', 'published').first();
    if (!p) throw new HttpError(404, 'Post not found');
    res.json({ post: out(p) });
  });

  // ---- staff (news.manage) ----
  const can = requirePermission('news.manage');

  r.get('/dev/news', can, async (_req, res) => {
    res.json({ posts: (await base().orderBy('n.updated_at', 'desc')).map((p) => out(p)) });
  });

  r.post('/dev/news', can, async (req, res) => {
    const b = parse(postSchema, req.body);
    if (await ctx.db('news_posts').where({ slug: b.slug }).first()) throw new HttpError(409, 'A post with that slug already exists');
    const now = new Date().toISOString();
    const [id] = await ctx.db('news_posts').insert({ ...toRow(b), status: b.status ?? 'draft', author_id: req.user!.id, created_at: now, updated_at: now, published_at: b.status === 'published' ? now : null });
    await audit(ctx.db, req, { action: 'news.create', category: 'news', targetType: 'news', targetId: id, targetLabel: b.slug, details: { status: b.status ?? 'draft' } });
    res.status(201).json({ post: out(await base().where('n.id', id).first()) });
  });

  r.patch('/dev/news/:id', can, async (req, res) => {
    const id = Number(req.params.id);
    const p = await ctx.db('news_posts').where({ id }).first();
    if (!p) throw new HttpError(404, 'Post not found');
    const b = parse(postSchema.partial(), req.body);
    if (b.slug && b.slug !== p.slug && (await ctx.db('news_posts').where({ slug: b.slug }).first())) throw new HttpError(409, 'Slug already in use');
    const row: Record<string, unknown> = { ...toRow(b), updated_at: new Date().toISOString() };
    if (b.status === 'published' && !p.published_at) row.published_at = new Date().toISOString();
    await ctx.db('news_posts').where({ id }).update(row);
    await audit(ctx.db, req, { action: 'news.update', category: 'news', targetType: 'news', targetId: id, targetLabel: p.slug, details: { fields: Object.keys(b) } });
    res.json({ post: out(await base().where('n.id', id).first()) });
  });

  r.post('/dev/news/:id/status', can, async (req, res) => {
    const id = Number(req.params.id);
    const p = await ctx.db('news_posts').where({ id }).first();
    if (!p) throw new HttpError(404, 'Post not found');
    const { status } = parse(z.object({ status: z.enum(['draft', 'published']) }), req.body);
    const now = new Date().toISOString();
    await ctx.db('news_posts').where({ id }).update({ status, updated_at: now, ...(status === 'published' && !p.published_at ? { published_at: now } : {}) });
    await audit(ctx.db, req, { action: status === 'published' ? 'news.publish' : 'news.unpublish', category: 'news', targetType: 'news', targetId: id, targetLabel: p.slug });
    res.json({ post: out(await base().where('n.id', id).first()) });
  });

  r.post('/dev/news/:id/pin', can, async (req, res) => {
    const id = Number(req.params.id);
    const p = await ctx.db('news_posts').where({ id }).first();
    if (!p) throw new HttpError(404, 'Post not found');
    const { pinned } = parse(z.object({ pinned: z.boolean() }), req.body);
    await ctx.db('news_posts').where({ id }).update({ pinned, updated_at: new Date().toISOString() });
    await audit(ctx.db, req, { action: pinned ? 'news.pin' : 'news.unpin', category: 'news', targetType: 'news', targetId: id, targetLabel: p.slug });
    res.json({ post: out(await base().where('n.id', id).first()) });
  });

  return r;
}
