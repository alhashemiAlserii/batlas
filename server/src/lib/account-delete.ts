import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import type { UserRow } from './types.js';
import { HttpError } from './http.js';
import { mediaIdFromUrl } from './media.js';

/**
 * A player deleting their own account (POST /api/me/delete). Everything happens in ONE
 * transaction; any error rolls all of it back and the account is untouched.
 *
 * Deleted:     the users row, sessions, game tokens, email/reset tokens, Sky Crew flight results
 *              (scores), Sky Crew outfit, wallet, wallet ledger and owned items, and their avatar image.
 * Kept, anonymised (needed for integrity / moderation history):
 *   - audit_logs: every row stays. Their username becomes "deleted-user-<id>" as actor and as
 *     target, their IP address is removed from rows they made, and their username, display name
 *     or email inside the details JSON is replaced too. Numeric ids are kept (they no longer
 *     resolve to anyone).
 *   - contact_messages they sent while signed in: name, email and IP anonymised, text kept.
 *   - news posts / uploaded media / site events / settings they authored: kept, author unlinked.
 * Developers can never delete themselves this way (checked here, inside the transaction).
 */
export const anonName = (id: number) => `deleted-user-${id}`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scrub(value: unknown, exact: Set<string>, words: RegExp | null, anon: string): unknown {
  if (typeof value === 'string') {
    if (exact.has(value.toLowerCase())) return anon;
    return words ? value.replace(words, anon) : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, exact, words, anon));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, exact, words, anon)]));
  return value;
}

export interface DeleteResult {
  anon: string;
  removed: Record<string, number>;
  anonymised: Record<string, number>;
}

export async function deleteOwnAccount(db: Knex, userId: number, opts: { ip?: string | null; uploadDir?: string; beforeCommit?: (trx: Knex.Transaction) => Promise<void> } = {}): Promise<DeleteResult> {
  let legacyAvatarFile: string | null = null;
  const result = await db.transaction(async (trx) => {
    const q = trx<UserRow>('users').where({ id: userId });
    const u = await (String(db.client.config.client).includes('pg') ? q.forUpdate() : q).first();
    if (!u) throw new HttpError(404, 'Account not found.');
    if (u.role === 'DEVELOPER') throw new HttpError(403, 'Developer accounts cannot be deleted.', 'protected');
    const anon = anonName(u.id);
    const removed: Record<string, number> = {};
    const anonymised: Record<string, number> = {};

    // Sky Crew economy + outfits too (explicit, so it never depends on FK cascades being enabled)
    for (const t of ['sessions', 'game_tokens', 'auth_tokens', 'game_flights', 'game_profiles', 'owned_items', 'wallet_ledger', 'wallets']) removed[t] = await trx(t).where({ user_id: u.id }).delete();
    const avatarId = mediaIdFromUrl(u.avatar_url);
    removed.avatars = await trx('media').where({ uploaded_by: u.id, kind: 'avatar' }).orWhere((w) => { if (avatarId) w.where({ id: avatarId, kind: 'avatar' }); else w.whereRaw('1 = 0'); }).delete();
    if (u.avatar_url?.startsWith('/uploads/avatars/') && opts.uploadDir) legacyAvatarFile = path.join(opts.uploadDir, 'avatars', path.basename(u.avatar_url));

    anonymised.media_uploads = await trx('media').where({ uploaded_by: u.id }).update({ uploaded_by: null });
    anonymised.news_posts = await trx('news_posts').where({ author_id: u.id }).update({ author_id: null });
    anonymised.site_events = await trx('site_events').where({ created_by: u.id }).update({ created_by: null });
    anonymised.site_settings = await trx('site_settings').where({ updated_by: u.id }).update({ updated_by: null });
    anonymised.contact_messages = await trx('contact_messages').where({ user_id: u.id }).update({ user_id: null, name: anon, email: `${anon}@deleted.invalid`, ip: null });

    // ---- audit log: keep every row, remove what identifies the person
    const names = [u.username, u.display_name, u.email].filter((s): s is string => !!s && s.length >= 3);
    const exact = new Set(names.map((s) => s.toLowerCase()));
    const words = new RegExp(`(?<![A-Za-z0-9_])(${names.map(esc).join('|')})(?![A-Za-z0-9_])`, 'gi');
    let n = 0;
    n += await trx('audit_logs').where({ actor_id: u.id }).update({ actor_username: anon, ip: null });
    n += await trx('audit_logs').where({ target_type: 'user', target_id: String(u.id) }).update({ target_label: anon });
    // rows whose details mention them: linked rows get whole-word replacement, others exact values only
    const like = trx('audit_logs').select('id', 'actor_id', 'target_type', 'target_id', 'target_label', 'details').where((w) => {
      for (const s of names) w.orWhereRaw("lower(details) like ? escape '\\'", [`%${s.toLowerCase().replace(/[%_\\]/g, (c) => '\\' + c)}%`]);
    });
    for (const row of await like) {
      const linked = Number(row.actor_id) === u.id || (row.target_type === 'user' && String(row.target_id) === String(u.id));
      let details: unknown;
      try { details = JSON.parse(row.details); } catch { details = row.details; }
      const next = JSON.stringify(scrub(details, exact, linked ? words : null, anon));
      if (next !== JSON.stringify(details)) { await trx('audit_logs').where({ id: row.id }).update({ details: next }); n++; }
    }
    // target labels equal to their name on non-user targets (e.g. game-server audit rows)
    n += await trx('audit_logs').whereRaw('lower(target_label) in (' + names.map(() => '?').join(',') + ')', names.map((s) => s.toLowerCase())).update({ target_label: anon });
    anonymised.audit_logs = n;

    await trx('audit_logs').insert({
      actor_id: u.id, actor_username: anon, actor_role: u.role,
      action: 'account.self_delete', category: 'auth',
      target_type: 'user', target_id: String(u.id), target_label: anon,
      details: JSON.stringify({ role: u.role, removed, anonymised }),
      ip: null, created_at: new Date().toISOString(),
    });
    const del = await trx('users').where({ id: u.id }).andWhereNot({ role: 'DEVELOPER' }).delete();
    if (del !== 1) throw new HttpError(409, 'Account changed while deleting; nothing was deleted.');
    if (opts.beforeCommit) await opts.beforeCommit(trx);
    return { anon, removed, anonymised };
  });
  if (legacyAvatarFile) await fs.promises.unlink(legacyAvatarFile).catch(() => {});
  return result;
}
