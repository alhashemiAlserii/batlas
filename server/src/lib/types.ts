import type { Knex } from 'knex';
import type { Role } from './permissions.js';
import type { AppConfig } from '../config.js';
import type { Mailer } from './mailer.js';

export interface UserRow {
  id: number;
  username: string;
  username_lower: string;
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
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name ?? u.username,
    role: u.role,
    bio: u.bio ?? '',
    avatarUrl: u.avatar_url ?? '',
    createdAt: u.created_at,
  };
}

export function selfUser(u: UserRow) {
  return { ...publicUser(u), email: u.email ?? '', emailVerified: !!u.email_verified_at, mustChangePassword: !!u.must_change_password };
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
