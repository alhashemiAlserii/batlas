import type { Knex } from 'knex';
import { HttpError } from './http.js';

/** Failed PIN attempts before that account or IP is locked, and how long the lock lasts. */
export const ACCOUNT_FAIL_LIMIT = 5;
export const IP_FAIL_LIMIT = 15;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

export interface LockState {
  locked: boolean;
  scope: 'account' | 'ip' | null;
}

function lockedUntil(row: { locked_until?: string | null } | undefined): boolean {
  return !!row?.locked_until && Date.parse(row.locked_until) > Date.now();
}

/** Throws 429 when this account or this IP is inside a lock window. Does not record a new failure. */
export async function assertUnlocked(db: Knex, userId: number | null, ip: string | null): Promise<void> {
  if (userId != null) {
    const row = await db('auth_lockouts').where({ scope: 'account', subject: String(userId) }).first();
    if (lockedUntil(row)) throw new HttpError(429, 'Too many attempts on this account. Wait 15 minutes and try again.', 'locked');
  }
  if (ip) {
    const row = await db('auth_lockouts').where({ scope: 'ip', subject: ip.slice(0, 64) }).first();
    if (lockedUntil(row)) throw new HttpError(429, 'Too many attempts from this network. Wait 15 minutes and try again.', 'locked');
  }
}

/**
 * Count one failed sign-in. Returns whether the account and/or IP just became locked.
 * The PIN itself is never passed in and never stored.
 */
export async function recordFailure(db: Knex, userId: number | null, ip: string | null): Promise<{ accountLocked: boolean; ipLocked: boolean }> {
  const now = new Date();
  const bump = async (scope: 'account' | 'ip', subject: string, limit: number) => {
    const row = await db('auth_lockouts').where({ scope, subject }).first();
    const windowStart = row?.window_start ? Date.parse(String(row.window_start)) : 0;
    const inWindow = !!row && now.getTime() - windowStart < LOCK_WINDOW_MS;
    const failures = inWindow ? Number(row.failures ?? 0) + 1 : 1;
    const locked = failures >= limit;
    const data = {
      failures,
      window_start: inWindow ? row.window_start : now.toISOString(),
      locked_until: locked ? new Date(now.getTime() + LOCK_MS).toISOString() : null,
    };
    if (row) await db('auth_lockouts').where({ scope, subject }).update(data);
    else await db('auth_lockouts').insert({ scope, subject, ...data });
    return locked;
  };
  const accountLocked = userId != null ? await bump('account', String(userId), ACCOUNT_FAIL_LIMIT) : false;
  const ipLocked = ip ? await bump('ip', ip.slice(0, 64), IP_FAIL_LIMIT) : false;
  return { accountLocked, ipLocked };
}

export async function clearAccountFailures(db: Knex, userId: number): Promise<void> {
  await db('auth_lockouts').where({ scope: 'account', subject: String(userId) }).delete();
}
