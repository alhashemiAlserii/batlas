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

/** Unlisted route for the Developer dashboard. Not linked anywhere public; protected server-side regardless. */
export const DEV_DASHBOARD_PATH = '/studio-console';

export function createApp(db: Knex, configOverrides: Partial<AppConfig> = {}, deps: { mailer?: Mailer } = {}) {
  const config = loadConfig(configOverrides);
  const ctx: Ctx = { db, config, mailer: deps.mailer ?? new FileMailer(config.outboxDir) };
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

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
          connectSrc: ["'self'"],
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
  app.use(cookieParser());
  app.use(express.json({ limit: '200kb' }));
  app.use(loadUser(ctx));

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
  app.get('/forgot-password', page('forgot.html'));
  app.get('/reset-password', page('reset.html'));
  app.get('/verify-email', page('verify.html'));

  app.get('/admin', gated('admin.panel', 'admin.html', false));
  app.get('/admin/app.js', gated('admin.panel', 'admin.js', true));
  app.get(DEV_DASHBOARD_PATH, gated('dev.menu', 'console.html', true));
  app.get(`${DEV_DASHBOARD_PATH}/app.js`, gated('dev.menu', 'console.js', true));

  app.use('/uploads', express.static(config.uploadDir, { index: false, dotfiles: 'deny', maxAge: '7d' }));
  app.use(express.static(pub, { index: false, extensions: [] }));

  app.use((req, res) => {
    res.status(404).sendFile(path.join(pub, '404.html'));
  });
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => errorHandler(err, req, res, next));

  return { app, ctx };
}
