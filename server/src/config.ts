import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const WEB_ROOT = path.resolve(SERVER_ROOT, '..', 'web');

export interface AppConfig {
  dbFile: string;
  uploadDir: string;
  cookieSecure: boolean;
  sessionTtlMs: number;
  gameServerKey: string | null;
  trustProxy: boolean;
  rateLimit: { windowMs: number; max: number };
  studioName: string;
  publicUrl: string;
  /** Email-based features (verification, forgot-password). Off by default: email is optional. */
  emailEnabled: boolean;
  outboxDir: string;
  contactRateLimit: { windowMs: number; max: number };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const prod = process.env.NODE_ENV === 'production';
  return {
    dbFile: process.env.DB_FILE ?? path.join(SERVER_ROOT, 'data', 'studio.sqlite'),
    uploadDir: process.env.UPLOAD_DIR ?? path.join(SERVER_ROOT, 'uploads'),
    // Secure cookies are required in production (HTTPS). Local http dev can opt out.
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : prod,
    sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
    gameServerKey: process.env.GAME_SERVER_KEY ?? null,
    trustProxy: process.env.TRUST_PROXY === 'true',
    rateLimit: { windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_RATE_LIMIT ?? 20) },
    studioName: process.env.STUDIO_NAME ?? 'Batlas',
    publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ''),
    emailEnabled: process.env.EMAIL_ENABLED === 'true',
    outboxDir: process.env.OUTBOX_DIR ?? path.join(SERVER_ROOT, 'data', 'outbox'),
    contactRateLimit: { windowMs: 60 * 60 * 1000, max: Number(process.env.CONTACT_RATE_LIMIT ?? 5) },
    ...overrides,
  };
}
