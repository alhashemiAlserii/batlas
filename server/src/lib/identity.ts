import type { Knex } from 'knex';
import { HttpError } from './http.js';
import type { UserRow } from './types.js';

/** Columns that store the handle. `username*` stays identical so older queries, backups and clients keep working. */
export function identityColumns(handle: string) {
  const lower = handle.toLowerCase();
  return { handle, handle_lower: lower, username: handle, username_lower: lower };
}

export function handleOf(u: { handle?: string | null; username?: string | null }): string {
  return (u.handle || u.username || '').trim();
}

export function displayNameOf(u: { display_name?: string | null; handle?: string | null; username?: string | null }): string {
  const d = (u.display_name ?? '').trim();
  return d || handleOf(u);
}

export function pinIsSet(u: { pin_set?: number | boolean | null }): boolean {
  return !!u.pin_set;
}

export function isPin(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4,6}$/.test(v);
}

/** Reject anything that is not a 4–6 digit PIN. Used when choosing a new PIN. */
export function requirePin(value: unknown, label = 'PIN'): string {
  if (!isPin(value)) throw new HttpError(400, `${label} must be 4 to 6 digits.`, 'validation_error');
  return value;
}

/**
 * Read a submitted PIN from `pin` or the older `password` field.
 * A missing value is `missing`. A present value that is not a PIN is a failed attempt (`pin: null`),
 * so sign-in does not answer "bad format" differently from "wrong PIN".
 */
export function readSubmittedPin(body: { pin?: unknown; password?: unknown } | null | undefined): { missing: boolean; pin: string | null } {
  const raw = body?.pin ?? body?.password;
  if (typeof raw !== 'string' || raw.length === 0) return { missing: true, pin: null };
  if (!isPin(raw)) return { missing: false, pin: null };
  return { missing: false, pin: raw };
}

/** Case-insensitive handle lookup. Email is not a sign-in identifier. */
export async function findUserByHandle(db: Knex, login: string): Promise<UserRow | undefined> {
  const l = login.trim().toLowerCase().slice(0, 64);
  if (!l) return undefined;
  return db<UserRow>('users').where((b) => b.where({ handle_lower: l }).orWhere({ username_lower: l })).first();
}

export async function handleTaken(db: Knex, handle: string, exceptId?: number): Promise<boolean> {
  const l = handle.toLowerCase();
  const q = db('users').where((b) => b.where({ handle_lower: l }).orWhere({ username_lower: l }));
  if (exceptId) q.andWhereNot({ id: exceptId });
  return !!(await q.first('id'));
}
