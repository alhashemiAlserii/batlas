/**
 * Central permission map. This file is the single source of truth for what each
 * rank may do. The server checks these on every request; UIs only *render*
 * from /api/me/permissions and never decide anything themselves.
 */
export const ROLES = ['PLAYER', 'TRUSTED', 'ADMIN', 'DEVELOPER'] as const;
export type Role = (typeof ROLES)[number];

/** Higher number = more authority. */
export const ROLE_LEVEL: Record<Role, number> = {
  PLAYER: 0,
  TRUSTED: 1,
  ADMIN: 2,
  DEVELOPER: 3,
};

export const PERMISSIONS = [
  // items
  'items.spawn.approved',
  'items.spawn.any',
  'items.spawn.developer', // exclusive fictional developer weapons/abilities
  // moderation
  'players.ban',
  'players.kick',
  'moderation.view',
  'players.view',
  'players.reset_password', // staff-issued one-time temporary password
  // world / game control
  'weather.change',
  'environment.control',
  'emergency.trigger',
  'emergency.manage',
  'events.control',
  'teleport',
  'npc.control',
  // admin / dev
  'admin.commands',
  'admin.panel',
  'dev.menu',
  'dev.commands',
  'settings.modify',
  'games.manage',
  'audit.view',
  'news.manage', // create/edit/publish/pin announcements (Developer only by default)
  'inbox.view', // contact-form messages
  'stats.view', // player statistics
  // roles
  'roles.grant.trusted',
  'roles.grant.admin',
  'roles.grant.developer',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const TRUSTED_PERMS: Permission[] = ['items.spawn.approved', 'admin.panel'];

const ADMIN_PERMS: Permission[] = [
  ...TRUSTED_PERMS,
  'players.ban',
  'players.kick',
  'players.view',
  'players.reset_password',
  'moderation.view',
  'weather.change',
  'emergency.trigger',
  'emergency.manage',
  'admin.commands',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  PLAYER: new Set<Permission>([]),
  TRUSTED: new Set<Permission>(TRUSTED_PERMS),
  ADMIN: new Set<Permission>(ADMIN_PERMS),
  // Developer = every permission that exists.
  DEVELOPER: new Set<Permission>(PERMISSIONS),
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(perm) ?? false;
}

export interface Actor {
  id: number;
  role: Role;
}

/**
 * Can `actor` perform a moderation action (ban/kick/restrict/role change) on `target`?
 * - Nobody can act on a Developer through the API (Developer protection).
 * - Nobody can act on themselves.
 * - Admins may act only on ranks strictly below them (Players & Trusted), not other Admins.
 * - Developers may act on anyone except Developers.
 */
export function canActOn(actor: Actor, target: Actor): { ok: true } | { ok: false; reason: string } {
  if (target.role === 'DEVELOPER') return { ok: false, reason: 'The Developer account is protected.' };
  if (actor.id === target.id) return { ok: false, reason: 'You cannot perform this action on yourself.' };
  if (ROLE_LEVEL[actor.role] <= ROLE_LEVEL[target.role]) {
    return { ok: false, reason: 'You can only act on players with a lower rank than yours.' };
  }
  return { ok: true };
}

/** Which permission is needed to assign (or remove) a given role. */
export function permissionToAssign(role: Role): Permission | null {
  switch (role) {
    case 'DEVELOPER':
      return 'roles.grant.developer';
    case 'ADMIN':
      return 'roles.grant.admin';
    case 'TRUSTED':
      return 'roles.grant.trusted';
    case 'PLAYER':
      return null;
  }
}

/** Spawn tiers for in-game items, mapped to the permission they need. */
export const ITEM_TIERS = {
  approved: 'items.spawn.approved',
  any: 'items.spawn.any',
  developer: 'items.spawn.developer',
} as const satisfies Record<string, Permission>;
export type ItemTier = keyof typeof ITEM_TIERS;
