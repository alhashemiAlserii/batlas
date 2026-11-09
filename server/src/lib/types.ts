import type { Knex } from 'knex';
import type { Role } from './permissions.js';
import type { AppConfig } from '../config.js';

export interface UserRow {
  id: number;
  username: string;
  username_lower: string;
  email: string;
  email_lower: string;
  password_hash: string;
  role: Role;
  display_name: string | null;
  bio: string | null;
  banned: number | boolean;
  ban_reason: string | null;
  banned_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface Ctx {
  db: Knex;
  config: AppConfig;
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
    createdAt: u.created_at,
  };
}

export function selfUser(u: UserRow) {
  return { ...publicUser(u), email: u.email };
}

export function adminUser(u: UserRow) {
  return {
    ...publicUser(u),
    email: u.email,
    banned: !!u.banned,
    banReason: u.ban_reason,
    bannedAt: u.banned_at,
    lastLoginAt: u.last_login_at,
  };
}
