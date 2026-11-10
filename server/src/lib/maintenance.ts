import type { Knex } from 'knex';

/**
 * Maintenance mode.
 *
 * - Stored in the `site_settings` table (key "maintenance"), toggled by the Developer in
 *   /studio-console (PUT /api/dev/maintenance, audit-logged).
 * - `MAINTENANCE_MODE=true` in the environment forces it ON regardless of the database.
 * - While on, only a signed-in DEVELOPER can use the site; everyone else gets the maintenance page
 *   (pages) or HTTP 503 `{ code: 'maintenance' }` (API). /healthz and /api/internal/backup keep working.
 *
 * Other servers in this process (e.g. the Sky Crew WebSocket server) can hook in with:
 *
 *   import { isMaintenance, maintenanceBlocks } from '../lib/maintenance.js';
 *   if (await maintenanceBlocks(db, user.role)) refuse('maintenance');
 *
 * Reads are cached for CACHE_MS per database handle; setMaintenance() clears the cache at once.
 */
export interface MaintenanceState {
  on: boolean;
  /** true when MAINTENANCE_MODE=true forces it on (the dashboard cannot switch it off). */
  forced: boolean;
  enabled: boolean; // the stored (dashboard) setting
  message: string;
  eta: string | null; // ISO timestamp or null
  updatedAt: string | null;
}

export const CACHE_MS = 5000;
const KEY = 'maintenance';
const cache = new WeakMap<Knex, { at: number; v: Omit<MaintenanceState, 'on' | 'forced'> }>();

export const envForcesMaintenance = () => String(process.env.MAINTENANCE_MODE ?? '').toLowerCase() === 'true';

export async function getMaintenance(db: Knex): Promise<MaintenanceState> {
  let c = cache.get(db);
  if (!c || Date.now() - c.at > CACHE_MS) {
    let v = { enabled: false, message: '', eta: null as string | null, updatedAt: null as string | null };
    try {
      const row = await db('site_settings').where({ key: KEY }).first();
      if (row?.value) {
        const j = JSON.parse(row.value);
        v = { enabled: !!j.enabled, message: String(j.message ?? ''), eta: j.eta ? String(j.eta) : null, updatedAt: row.updated_at ?? null };
      }
    } catch {
      // If the DB can't be read, fall back to "off" unless the env forces it (don't lock the owner out).
    }
    c = { at: Date.now(), v };
    cache.set(db, c);
  }
  const forced = envForcesMaintenance();
  return { ...c.v, forced, on: forced || c.v.enabled };
}

/** Is maintenance mode on right now (env override or dashboard switch)? */
export async function isMaintenance(db: Knex): Promise<boolean> {
  return (await getMaintenance(db)).on;
}

/** Should a user with this role (null = signed out) be kept out right now? Developers always pass. */
export async function maintenanceBlocks(db: Knex, role: string | null | undefined): Promise<boolean> {
  if (role === 'DEVELOPER') return false;
  return isMaintenance(db);
}

export async function setMaintenance(db: Knex, v: { enabled: boolean; message?: string; eta?: string | null }, userId: number | null) {
  const value = JSON.stringify({ enabled: v.enabled, message: v.message ?? '', eta: v.eta ?? null });
  const now = new Date().toISOString();
  const exists = await db('site_settings').where({ key: KEY }).first();
  if (exists) await db('site_settings').where({ key: KEY }).update({ value, updated_by: userId, updated_at: now });
  else await db('site_settings').insert({ key: KEY, value, updated_by: userId, updated_at: now });
  cache.delete(db);
  return getMaintenance(db);
}

export const clearMaintenanceCache = (db: Knex) => cache.delete(db);
