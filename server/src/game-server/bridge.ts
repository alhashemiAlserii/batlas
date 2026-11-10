/** How the game server talks to the Batlas website: token verification + audit log. */
import type { Permission, Role } from '../lib/permissions.js';

export interface VerifiedUser {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
  permissions: Permission[];
  avatarUrl: string;
}

export interface AuditCall {
  actorUserId: number;
  action: string;
  targetUserId?: number;
  targetLabel?: string;
  details?: Record<string, unknown>;
}

export interface BanCall {
  actorUserId: number;
  targetUserId: number;
  reason?: string;
}

export interface SiteBridge {
  /** null = invalid token; { maintenance } = the site refused because maintenance mode is on */
  verify(token: string): Promise<VerifiedUser | null | { maintenance: true; message?: string | null }>;
  audit(entry: AuditCall): Promise<void>;
  /** Account ban on the website. The site re-checks the actor's rank (players.ban + canActOn) in its own DB. */
  ban?(entry: BanCall): Promise<{ ok: boolean; reason?: string }>;
}

/** Talks to the site over HTTP with the shared GAME_SERVER_KEY, so the game server can run anywhere. */
export function httpSiteBridge(siteUrl: string, key: string): SiteBridge {
  const base = siteUrl.replace(/\/$/, '');
  return {
    async verify(token) {
      const r = await fetch(`${base}/api/game/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-game-server-key': key },
        body: JSON.stringify({ token }),
      });
      if (r.status === 503) { const m: any = await r.json().catch(() => ({})); if (m.code === 'maintenance') return { maintenance: true as const, message: m.message ?? null }; }
      if (!r.ok) return null;
      const d: any = await r.json();
      if (!d.valid) return null;
      return {
        userId: d.user.id,
        username: d.user.username,
        displayName: d.user.displayName,
        role: d.role,
        permissions: d.permissions,
        avatarUrl: d.user.avatarUrl ?? '',
      };
    },
    async audit(entry) {
      const r = await fetch(`${base}/api/game/audit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-game-server-key': key },
        body: JSON.stringify(entry),
      });
      if (!r.ok) console.error('[game] audit failed', r.status);
    },
    async ban(entry) {
      const r = await fetch(`${base}/api/game/ban`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-game-server-key': key },
        body: JSON.stringify(entry),
      });
      const d: any = await r.json().catch(() => ({}));
      return r.ok ? { ok: true } : { ok: false, reason: d.error ?? `ban failed (${r.status})` };
    },
  };
}
