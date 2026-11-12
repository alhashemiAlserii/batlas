import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import type { Knex } from 'knex';
import { loadConfig, WEB_ROOT, type AppConfig } from './config.js';
import type { Ctx } from './lib/types.js';
import { errorHandler, HttpError } from './lib/http.js';
import { csrfProtect, loadUser, issueCsrf, enforcePasswordChange } from './lib/session.js';
import { hasPermission, type Permission } from './lib/permissions.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';
import { gamesRoutes } from './routes/games.js';
import { gameRoutes } from './routes/game.js';
import { accountRoutes } from './routes/account.js';
import { newsRoutes } from './routes/news.js';
import { contactRoutes } from './routes/contact.js';
import { statsRoutes } from './routes/stats.js';
import { FileMailer, type Mailer } from './lib/mailer.js';
import { dumpDatabase } from './lib/backup.js';
import { audit } from './lib/audit.js';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { siteRoutes, type LiveRoomsProvider } from './routes/site.js';
import { serveMedia } from './lib/media.js';
import { getMaintenance } from './lib/maintenance.js';
import { mountRestoreEndpoint } from './routes/restore-endpoint.js';

/** Paths that keep working in maintenance mode for everyone (static assets for the maintenance page). */
const MAINT_ASSET = /^\/(css|js|img|fonts|media|uploads)\/|^\/(favicon\.ico|sw\.js|manifest\.webmanifest|offline\.html|apple-touch-icon\.png)$/;
/** API calls that keep working in maintenance mode (login itself refuses non-Developers with 503). */
const MAINT_API_OPEN = new Set(['GET /api/csrf', 'GET /api/site', 'GET /api/maintenance', 'GET /api/health', 'POST /api/auth/login', 'POST /api/auth/pin/setup', 'POST /api/auth/logout', 'POST /api/game/verify', 'POST /api/game/audit', 'POST /api/game/ban', 'POST /api/game/owned', 'POST /api/game/salary', 'POST /api/game/grant', 'GET /api/internal/backup']);

/** Unlisted route for the Developer dashboard. Not linked anywhere public; protected server-side regardless. */
export const DEV_DASHBOARD_PATH = '/studio-console';

export function createApp(db: Knex, configOverrides: Partial<AppConfig> = {}, deps: { mailer?: Mailer; liveRooms?: LiveRoomsProvider } = {}) {
  const config = loadConfig(configOverrides);
  const ctx: Ctx = { db, config, mailer: deps.mailer ?? new FileMailer(config.outboxDir) };
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // Load-balancer health check (Render healthCheckPath): no cookies, no session lookup.
  app.get('/healthz', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await db.raw('select 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Off-site backups over HTTPS (the database port is not reachable from everywhere).
  // Bearer-token only: no cookies, no session; 404 unless BACKUP_TOKEN (32+ chars) is configured.
  const backupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.backupRateLimit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many backup requests', code: 'rate_limited' } });
  app.get('/api/internal/backup', (req, res, next) => {
    const token = config.backupToken;
    if (!token || token.length < 32) return res.status(404).json({ error: 'Not found' });
    next();
  }, backupLimiter, async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ''));
      const want = crypto.createHash('sha256').update(config.backupToken!).digest();
      const got = crypto.createHash('sha256').update(m?.[1] ?? '').digest();
      if (!m || !crypto.timingSafeEqual(want, got)) {
        await audit(db, req, { action: 'backup.denied', category: 'admin' }, { id: 0, username: 'backup-endpoint', role: 'SYSTEM' });
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { dump, rows } = await dumpDatabase(db);
      await audit(db, req, { action: 'backup.download', category: 'admin', details: { tables: Object.keys(dump.tables).length, rows } }, { id: 0, username: 'backup-endpoint', role: 'SYSTEM' });
      res.json(dump);
    } catch (e) {
      next(e);
    }
  });

  // Restore over HTTPS (moving to a new database). 404 unless RESTORE_TOKEN is set; see routes/restore-endpoint.ts.
  mountRestoreEndpoint(app, ctx);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          mediaSrc: ["'self'", 'https:'],
          frameSrc: ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com'],
          // 'self' covers ws(s) of the same host in modern browsers; list it explicitly for older Safari.
          connectSrc: [
            "'self'",
            (req) => {
              const host = String((req as { headers: { host?: string } }).headers.host ?? '');
              return /^[a-z0-9.\-]+(:\d{1,5})?$/i.test(host) ? `${config.cookieSecure ? 'wss' : 'ws'}://${host}` : "'self'";
            },
          ],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
          // Only upgrade when we are actually on HTTPS, otherwise local http dev breaks in Safari.
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
      hsts: config.cookieSecure ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser(config.sessionSecret ?? undefined));
  app.use(express.json({ limit: '200kb' }));
  app.use(loadUser(ctx));

  // ---------- Maintenance mode ----------
  // Everyone except a signed-in DEVELOPER gets the maintenance page (pages) or 503 (API).
  // /healthz and /api/internal/backup are registered above this, so they are never affected.
  app.use(async (req, res, next) => {
    try {
      if (req.user?.role === 'DEVELOPER' || MAINT_ASSET.test(req.path) || req.path === '/healthz') return next();
      // The one-time Developer PIN page decides 404 vs the form itself. Maintenance must not hide that 404.
      if (req.path === '/setup-developer-pin' || req.path === '/api/auth/developer-pin/bootstrap') return next();
      const m = await getMaintenance(db);
      if (!m.on) return next();
      res.set('Cache-Control', 'no-store');
      res.set('Retry-After', String(m.eta ? Math.max(60, Math.round((Date.parse(m.eta) - Date.now()) / 1000)) : 600));
      if (req.path.startsWith('/api/')) {
        if (MAINT_API_OPEN.has(`${req.method} ${req.path}`)) return next();
        return res.status(503).json({ error: 'Batlas is under maintenance. Please try again later.', code: 'maintenance', message: m.message, eta: m.eta });
      }
      if ((req.path === '/login' || req.path === '/set-pin') && req.method === 'GET') return next(); // so the Developer can still sign in or set a PIN
      issueCsrf(ctx, res, false, req);
      return res.status(503).sendFile(path.join(WEB_ROOT, 'public', 'maintenance.html'));
    } catch (e) {
      next(e);
    }
  });

  // ---------- API ----------
  const api = express.Router();
  api.use(csrfProtect(ctx));
  api.use(enforcePasswordChange);
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.get('/site', (_req, res) => res.json({ studioName: config.studioName, emailEnabled: config.emailEnabled }));
  api.use(authRoutes(ctx));
  api.use(meRoutes(ctx));
  api.use(adminRoutes(ctx));
  api.use(gamesRoutes(ctx));
  api.use(gameRoutes(ctx));
  api.use(accountRoutes(ctx));
  api.use(newsRoutes(ctx));
  api.use(contactRoutes(ctx));
  api.use(statsRoutes(ctx));
  api.use(siteRoutes(ctx, { liveRooms: deps.liveRooms }));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  api.use(errorHandler);
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, api);

  // ---------- Pages ----------
  const pub = path.join(WEB_ROOT, 'public');
  const priv = path.join(WEB_ROOT, 'private');
  const page = (file: string) => (req: Request, res: Response) => {
    issueCsrf(ctx, res, false, req);
    res.sendFile(path.join(pub, file));
  };

  /** Gated pages are served from web/private only after a server-side permission check. */
  const gated = (perm: Permission, file: string, hideAs404: boolean) => (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user || !hasPermission(req.user.role, perm)) {
      if (hideAs404) return res.status(404).sendFile(path.join(pub, '404.html'));
      if (!req.user) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
      return res.status(403).sendFile(path.join(pub, '403.html'));
    }
    issueCsrf(ctx, res, false, req);
    res.sendFile(path.join(priv, file));
  };

  app.get('/', page('index.html'));
  app.get('/games', page('games.html'));
  app.get('/games/:slug', page('game.html'));
  app.get('/login', page('login.html'));
  app.get('/register', page('register.html'));
  app.get('/profile', page('profile.html'));
  app.get('/u/:username', page('profile.html'));
  app.get('/contact', page('contact.html'));
  app.get('/news', page('news.html'));
  app.get('/news/:slug', page('post.html'));
  app.get('/settings', page('settings.html'));
  app.get('/set-pin', page('set-pin.html'));
  app.get('/setup-developer-pin', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!(config.developerPinBootstrapToken ?? '').trim()) return res.status(404).sendFile(path.join(pub, '404.html'));
    issueCsrf(ctx, res, false, req);
    res.sendFile(path.join(pub, 'setup-developer-pin.html'));
  });
  app.get('/forgot-password', page('forgot.html'));
  app.get('/reset-password', page('reset.html'));
  app.get('/verify-email', page('verify.html'));
  app.get('/play/sky-crew', page('play/sky-crew/index.html'));
  app.get('/play/sky-crew/', (_req, res) => res.redirect(301, '/play/sky-crew'));

  app.get('/admin', gated('admin.panel', 'admin.html', false));
  app.get('/admin/app.js', gated('admin.panel', 'admin.js', true));
  app.get(DEV_DASHBOARD_PATH, gated('dev.menu', 'console.html', true));
  app.get(`${DEV_DASHBOARD_PATH}/app.js`, gated('dev.menu', 'console.js', true));

  // Database-backed uploads (images, trailers, avatars) with Range support for iOS Safari video.
  app.get('/media/:id', (req, res, next) => { serveMedia(db, req, res).catch(next); });
  app.use('/uploads', express.static(config.uploadDir, { index: false, dotfiles: 'deny', maxAge: '7d' }));
  // PWA: the service worker must always be revalidated so a new deploy's worker is picked up promptly.
  app.get('/sw.js', (_req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    res.type('application/javascript').sendFile(path.join(pub, 'sw.js'));
  });
  app.get('/manifest.webmanifest', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').sendFile(path.join(pub, 'manifest.webmanifest'));
  });
  app.use(express.static(pub, { index: false, extensions: [] }));

  app.use((req, res) => {
    res.status(404).sendFile(path.join(pub, '404.html'));
  });
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorHandler(err, req, res, next));

  return { app, ctx };
}
