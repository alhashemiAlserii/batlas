import { Router } from 'express';
import type { Ctx } from '../lib/types.js';
import { requirePermission } from '../lib/session.js';
import { ROLES } from '../lib/permissions.js';

const DAY = 24 * 60 * 60 * 1000;

export function statsRoutes(ctx: Ctx) {
  const r = Router();
  r.get('/dev/stats', requirePermission('stats.view'), async (_req, res) => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const count = async (q: any) => Number((await q.count({ n: '*' }).first())?.n ?? 0);
    const users = () => ctx.db('users');

    const since30 = await users().where('created_at', '>=', iso(now - 30 * DAY)).select('created_at');
    // daily signups for the last 30 days (UTC dates)
    const days: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) days.push({ date: iso(now - i * DAY).slice(0, 10), count: 0 });
    for (const u of since30) {
      const d = String(u.created_at).slice(0, 10);
      const slot = days.find((x) => x.date === d);
      if (slot) slot.count++;
    }
    const byRoleRows = await users().select('role').count({ n: '*' }).groupBy('role');
    const byRole = Object.fromEntries(ROLES.map((r) => [r, 0]));
    for (const row of byRoleRows as any[]) byRole[row.role] = Number(row.n);
    const active = await ctx.db('sessions').where('expires_at', '>', iso(now)).countDistinct({ n: 'user_id' }).first();

    res.json({
      totalUsers: await count(users()),
      signups7d: await count(users().where('created_at', '>=', iso(now - 7 * DAY))),
      signups30d: since30.length,
      verifiedUsers: await count(users().whereNotNull('email_verified_at')),
      byRole,
      activeSessionUsers: Number(active?.n ?? 0),
      bannedUsers: await count(users().where({ banned: true })),
      logins7d: await count(users().where('last_login_at', '>=', iso(now - 7 * DAY))),
      games: await count(ctx.db('games')),
      newsPublished: await count(ctx.db('news_posts').where({ status: 'published' })),
      unreadMessages: await count(ctx.db('contact_messages').where({ status: 'new' })),
      moderationActions30d: await count(ctx.db('audit_logs').where({ category: 'moderation' }).andWhere('created_at', '>=', iso(now - 30 * DAY)).whereNot('action', 'like', '%.denied')),
      dailySignups: days,
      generatedAt: iso(now),
    });
  });
  return r;
}
