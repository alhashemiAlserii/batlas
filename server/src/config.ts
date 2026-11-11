import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const WEB_ROOT = path.resolve(SERVER_ROOT, '..', 'web');

export interface AppConfig {
  dbFile: string;
  /** Postgres URL (Render). When unset the SQLite file `dbFile` is used. */
  databaseUrl: string | null;
  uploadDir: string;
  cookieSecure: boolean;
  sessionTtlMs: number;
  gameServerKey: string | null;
  /** Cookie-signing secret (SESSION_SECRET). Sessions themselves are random DB-backed tokens. */
  sessionSecret: string | null;
  /** Bearer token for GET /api/internal/backup. The endpoint does not exist (404) unless this is 32+ chars. */
  backupToken: string | null;
  backupRateLimit: number;
  /** Bearer token for POST /api/internal/restore. Separate from BACKUP_TOKEN; the endpoint is 404 unless this is 32+ chars. */
  restoreToken: string | null;
  restoreRateLimit: number;
  /** Largest restore upload accepted, in bytes. */
  restoreMaxBytes: number;
  /** Where uploads are staged during a restore (default: the OS temp dir). */
  restoreTmpDir: string | null;
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
    databaseUrl: process.env.DATABASE_URL || null,
    uploadDir: process.env.UPLOAD_DIR ?? path.join(SERVER_ROOT, 'uploads'),
    // Secure cookies are required in production (HTTPS). Local http dev can opt out.
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : prod,
    sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
    gameServerKey: process.env.GAME_SERVER_KEY ?? null,
    sessionSecret: process.env.SESSION_SECRET || null,
    backupToken: process.env.BACKUP_TOKEN || null,
    backupRateLimit: Number(process.env.BACKUP_RATE_LIMIT ?? 12), // per IP per hour
    restoreToken: process.env.RESTORE_TOKEN || null,
    restoreRateLimit: Number(process.env.RESTORE_RATE_LIMIT ?? 10), // per IP per hour
    restoreMaxBytes: Number(process.env.RESTORE_MAX_BYTES ?? 2 * 1024 * 1024 * 1024),
    restoreTmpDir: process.env.RESTORE_TMP_DIR || null,
    // Behind Render's (or any) HTTPS proxy, so req.ip / secure cookies see the real client.
    trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY === 'true' : prod,
    rateLimit: { windowMs: 15 * 60 * 1000, max: Number(process.env.AUTH_RATE_LIMIT ?? 20) },
    studioName: process.env.STUDIO_NAME ?? 'Batlas',
    publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, ''),
    emailEnabled: process.env.EMAIL_ENABLED === 'true',
    outboxDir: process.env.OUTBOX_DIR ?? path.join(SERVER_ROOT, 'data', 'outbox'),
    contactRateLimit: { windowMs: 60 * 60 * 1000, max: Number(process.env.CONTACT_RATE_LIMIT ?? 5) },
    ...overrides,
  };
}

/** What createDb() should open: Postgres when DATABASE_URL is set, else the SQLite file. */
export const dbTarget = (c: AppConfig = loadConfig()) => c.databaseUrl ?? c.dbFile;
