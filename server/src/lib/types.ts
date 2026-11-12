import type { Knex } from 'knex';
import type { Role } from './permissions.js';
import type { AppConfig } from '../config.js';
import type { Mailer } from './mailer.js';

export interface UserRow {
  id: number;
  username: string;
  username_lower: string;
  /** Unique sign-in name. Same value as `username` (kept for older clients and backups). */
  handle?: string | null;
  handle_lower?: string | null;
  /** False until this account has replaced its password with a PIN. */
  pin_set?: number | boolean | null;
  email: string | null;
  email_lower: string | null;
  password_hash: string;
  role: Role;
  display_name: string | null;
  bio: string | null;
  banned: number | boolean;
  ban_reason: string | null;
  banned_at: string | null;
  created_at: string;
  last_login_at: string | null;
  email_verified_at: string | null;
  avatar_url: string | null;
  password_changed_at: string | null;
  must_change_password: number | boolean;
  last_seen_at?: string | null;
}

export interface Ctx {
  db: Knex;
  config: AppConfig;
  mailer: Mailer;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      sessionHash?: string;
      authVia?: 'session' | 'game-token';
    }
  }
}

export function publicUser(u: UserRow) {
  const handle = (u.handle || u.username || '').trim();
  const display = (u.display_name ?? '').trim() || handle;
  return {
    id: u.id,
    handle,
    username: handle, // alias: older clients still read `username` as the sign-in name
    displayName: display,
    role: u.role,
    bio: u.bio ?? '',
    avatarUrl: u.avatar_url ?? '',
    createdAt: u.created_at,
  };
}

export function selfUser(u: UserRow) {
  const mustChangePin = !!u.must_change_password;
  return {
    ...publicUser(u),
    email: u.email ?? '',
    emailVerified: !!u.email_verified_at,
    mustChangePin,
    mustChangePassword: mustChangePin, // alias so older pages still send the player to choose a new PIN
  };
}

export function adminUser(u: UserRow) {
  return {
    ...publicUser(u),
    email: u.email ?? '',
    emailVerified: !!u.email_verified_at,
    banned: !!u.banned,
    banReason: u.ban_reason,
    bannedAt: u.banned_at,
    lastLoginAt: u.last_login_at,
    lastSeenAt: u.last_seen_at ?? null,
  };
}
