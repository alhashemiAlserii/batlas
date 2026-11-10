/**
 * Maintenance switch for the Sky Crew game server.
 *
 * The website is getting a shared maintenance setting (DB setting + MAINTENANCE_MODE env override,
 * helper `isMaintenance()`). Until that lands, the game server reads MAINTENANCE_MODE itself.
 * To wire the shared helper later, pass it as `attachGameServer(..., { isMaintenance })`.
 */
export const MAINTENANCE_MESSAGE = 'Sky Crew is under maintenance. Please check back soon.';

export type MaintenanceCheck = () => boolean | Promise<boolean>;

const ON = new Set(['1', 'true', 'on', 'yes']);
/** Env fallback: MAINTENANCE_MODE=1|true|on|yes turns maintenance on. Read on every call, so flipping it at runtime works. */
export const envMaintenance: MaintenanceCheck = () => ON.has(String(process.env.MAINTENANCE_MODE ?? '').trim().toLowerCase());
