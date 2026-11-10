import type { Knex } from 'knex';
import type { Request } from 'express';

export type AuditCategory = 'moderation' | 'roles' | 'game' | 'games' | 'news' | 'auth' | 'admin' | 'site' | 'media';

export interface AuditEntry {
  action: string;
  category: AuditCategory;
  targetType?: string;
  targetId?: string | number;
  targetLabel?: string;
  details?: Record<string, unknown>;
}

export async function audit(db: Knex, req: Request | null, e: AuditEntry, actorOverride?: { id: number; username: string; role: string }) {
  const actor = actorOverride ?? req?.user;
  await db('audit_logs').insert({
    actor_id: actor?.id ?? null,
    actor_username: actor?.username ?? null,
    actor_role: actor?.role ?? null,
    action: e.action,
    category: e.category,
    target_type: e.targetType ?? null,
    target_id: e.targetId != null ? String(e.targetId) : null,
    target_label: e.targetLabel ?? null,
    details: e.details ? JSON.stringify(e.details) : null,
    ip: req?.ip ?? null,
    created_at: new Date().toISOString(),
  });
}
