import type { Knex } from 'knex';
import type { Role } from './permissions.js';

function earlyOnly(settings: unknown): boolean {
  try {
    const s = typeof settings === 'string' && settings ? JSON.parse(settings) : settings;
    return !!(s && typeof s === 'object' && (s as { earlyAccessOnly?: boolean }).earlyAccessOnly);
  } catch {
    return false;
  }
}

/** Ranks that may open a preview-only game without holding a pass. */
const STAFF: ReadonlySet<Role> = new Set(['TRUSTED', 'ADMIN', 'DEVELOPER']);

export type PassKind = 'early_access' | 'crew';

export function passActive(row: { revoked_at?: string | null; expires_at?: string | null }, now = Date.now()): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && Date.parse(row.expires_at) <= now) return false;
  return true;
}

/** Studio-wide (game_id null) or for this game. */
export async function hasActivePass(db: Knex, userId: number, kind: PassKind, gameId: number | null, now = new Date().toISOString()): Promise<boolean> {
  const rows = await db('passes').where({ user_id: userId, kind }).whereNull('revoked_at');
  const t = Date.parse(now);
  return rows.some((r) => passActive(r, t) && (r.game_id == null || (gameId != null && Number(r.game_id) === gameId)));
}

export async function canOpenGame(db: Knex, user: { id: number; role: Role } | null | undefined, game: { id: number; settings?: unknown } | null | undefined): Promise<boolean> {
  if (!game) return true;
  if (!earlyOnly(game.settings)) return true;
  if (!user) return false;
  if (STAFF.has(user.role)) return true;
  return hasActivePass(db, user.id, 'early_access', game.id);
}

/** Monday 00:00 UTC through the next Monday. */
export function weekWindow(now = new Date()): { start: string; resetsAt: string } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - sinceMonday * 86400000);
  const resetsAt = new Date(start.getTime() + 7 * 86400000);
  return { start: start.toISOString(), resetsAt: resetsAt.toISOString() };
}
