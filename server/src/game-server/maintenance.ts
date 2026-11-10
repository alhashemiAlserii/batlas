/**
 * Maintenance for the Sky Crew game server, wired to the website's shared switch
 * (server/src/lib/maintenance.ts: DB setting + MAINTENANCE_MODE env override).
 *
 * The game server checks it in three places: when a socket signs in (and /api/game/verify itself
 * refuses non-Developers), when a room is created/joined, and on a timer that removes
 * non-Developers from live rooms as soon as maintenance switches on. Developers always pass.
 */
import type { Knex } from 'knex';
import { getMaintenance, envForcesMaintenance } from '../lib/maintenance.js';

export const MAINTENANCE_MESSAGE = 'Sky Crew is under maintenance. Please check back soon.';

/** Returns whether maintenance is on (+ the Developer's custom message, if any). */
export type MaintenanceCheck = () => Promise<{ on: boolean; message?: string | null }> | { on: boolean; message?: string | null };

/** The shared site switch (dashboard setting or env override). */
export const siteMaintenance = (db: Knex): MaintenanceCheck => async () => {
  const m = await getMaintenance(db);
  return { on: m.on, message: m.message || null };
};
/** Fallback when the game server runs without the site database: MAINTENANCE_MODE=true only. */
export const envMaintenance: MaintenanceCheck = () => ({ on: envForcesMaintenance() });
