import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Ctx, UserRow } from './types.js';
import { randomToken, sha256, safeEqual } from './crypto.js';
import { hasPermission, type Permission } from './permissions.js';
import { HttpError } from './http.js';

export const cookieNames = (secure: boolean) => ({
  // __Host- prefix forces Secure + Path=/ + no Domain in browsers (only usable over HTTPS).
  session: secure ? '__Host-sid' : 'sid',
  csrf: secure ? '__Host-csrf' : 'csrf',
});

export async function createSession(ctx: Ctx, req: Request, res: Response, user: UserRow) {
  const token = randomToken(32);
  const idHash = sha256(token);
  const expires = new Date(Date.now() + ctx.config.sessionTtlMs);
  await ctx.db('sessions').insert({
    id_hash: idHash,
    user_id: user.id,
    expires_at: expires.toISOString(),
    created_at: new Date().toISOString(),
    ip: req.ip ?? null,
    user_agent: (req.get('user-agent') ?? '').slice(0, 256),
  });
  const names = cookieNames(ctx.config.cookieSecure);
  res.cookie(names.session, token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires,
  });
  // rotate CSRF token on login
  issueCsrf(ctx, res, true);
  return idHash;
}

export async function destroySession(ctx: Ctx, req: Request, res: Response) {
  if (req.sessionHash) await ctx.db('sessions').where({ id_hash: req.sessionHash }).delete();
  const names = cookieNames(ctx.config.cookieSecure);
  res.clearCookie(names.session, { path: '/', httpOnly: true, secure: ctx.config.cookieSecure, sameSite: 'lax' });
}

export function issueCsrf(ctx: Ctx, res: Response, force = false, req?: Request): string {
  const names = cookieNames(ctx.config.cookieSecure);
  const existing = req?.cookies?.[names.csrf];
  if (existing && !force) return existing;
  const tok = randomToken(24);
  res.cookie(names.csrf, tok, {
    httpOnly: false, // readable by our own JS for the double-submit header
    secure: ctx.config.cookieSecure,
    sameSite: 'strict',
    path: '/',
  });
  return tok;
}

/** Loads the user from the session cookie, or (for /api/game) from a Bearer game token. */
export function loadUser(ctx: Ctx): RequestHandler {
  return async (req, _res, next) => {
    try {
      const auth = req.get('authorization');
      if (auth?.startsWith('Bearer ')) {
        const tok = auth.slice(7).trim();
        const row = await ctx.db('game_tokens').where({ token_hash: sha256(tok) }).first();
        if (row && new Date(row.expires_at) > new Date()) {
          const user = await ctx.db<UserRow>('users').where({ id: row.user_id }).first();
          if (user && !user.banned) {
            req.user = user;
            req.authVia = 'game-token';
          }
        }
        return next(); // bearer requests never fall back to cookies
      }
      const names = cookieNames(ctx.config.cookieSecure);
      const token = req.cookies?.[names.session];
      if (!token) return next();
      const idHash = sha256(token);
      const s = await ctx.db('sessions').where({ id_hash: idHash }).first();
      if (!s) return next();
      if (new Date(s.expires_at) <= new Date()) {
        await ctx.db('sessions').where({ id_hash: idHash }).delete();
        return next();
      }
      const user = await ctx.db<UserRow>('users').where({ id: s.user_id }).first();
      if (!user || user.banned) return next();
      req.user = user;
      req.sessionHash = idHash;
      req.authVia = 'session';
      next();
    } catch (e) {
      next(e);
    }
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF check for cookie-authenticated, state-changing requests. */
export function csrfProtect(ctx: Ctx): RequestHandler {
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    // Bearer / server-key auth carries no ambient browser credentials, and custom headers
    // can't be sent cross-site without a CORS preflight (which we never allow).
    if (req.get('authorization') || req.get('x-game-server-key') || req.path === '/game/verify' || req.path === '/game/audit') return next();
    const names = cookieNames(ctx.config.cookieSecure);
    const cookieTok = req.cookies?.[names.csrf];
    const headerTok = req.get('x-csrf-token');
    if (!cookieTok || !headerTok || !safeEqual(cookieTok, headerTok)) {
      return next(new HttpError(403, 'Invalid or missing CSRF token', 'csrf'));
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Login required', 'unauthenticated'));
  next();
};

/** Server-side permission gate. The only thing that decides access. */
export function requirePermission(...perms: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Login required', 'unauthenticated'));
    for (const p of perms) {
      if (!hasPermission(req.user.role, p)) return next(new HttpError(403, 'You do not have permission to do that.', 'forbidden'));
    }
    next();
  };
}

/**
 * After a staff password reset the user must pick a new password before doing anything else.
 * Enforced on the server: only reading public pages/data, logging out and changing the password work.
 */
const FORCED_ALLOW = new Set(['POST /me/password', 'POST /auth/logout']);
export const enforcePasswordChange: RequestHandler = (req, _res, next) => {
  if (!req.user?.must_change_password) return next();
  const key = `${req.method} ${req.path}`;
  if (FORCED_ALLOW.has(key)) return next();
  const restricted = /^\/(admin|dev|game)(\/|$)/.test(req.path);
  if (SAFE.has(req.method) && !restricted) return next();
  next(new HttpError(403, 'Please choose a new password first.', 'password_change_required'));
};
