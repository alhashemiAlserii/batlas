# Batlas — Studio Website & Platform (Stage 1)

The official Batlas website, shared player accounts, rank system and Developer dashboard.
One account works across every Batlas game; game servers (starting with the co-op airplane
game) will authenticate players against this backend.

## Quick start

```bash
cd server
npm install
cp .env.example .env            # set GAME_SERVER_KEY to a long random value
npm run migrate                 # creates data/studio.sqlite
npm run create-developer -- --username abood --email you@example.com
                                # generated password -> data/developer-credentials.txt (chmod 600)
npm start                       # http://localhost:3000
npm test                        # vitest + supertest
```

| Script | What it does |
|---|---|
| `npm start` / `npm run dev` | Run the server (dev = auto-reload) |
| `npm run migrate` | Apply database migrations |
| `npm run create-developer -- --username U --email E [--password-file F] [--out F] [--promote]` | **Only** way to create/promote a Developer (owner). Never exposed over HTTP. |
| `npm test` | Run the automated test suite |
| `npm run typecheck` | TypeScript check |

## Stack

- **Backend:** Node.js 24, TypeScript (run with `tsx`), Express 5
- **Database:** SQLite through **Knex** with migrations (`server/src/db/migrations`). Switching to Postgres = change the Knex client/connection; schema is portable.
- **Auth:** argon2id hashing (`@node-rs/argon2`), opaque session tokens in an httpOnly, SameSite=Lax cookie (only a SHA-256 of the token is stored), `Secure` + `__Host-` prefix in production, double-submit CSRF token on every state-changing request, `express-rate-limit` on login/register, `zod` validation, `helmet` security headers incl. a strict CSP (no inline scripts/styles).
- **Frontend:** dependency-free HTML/CSS + ES modules in `web/` (no build step). Responsive, safe-area aware for iPhone; all DOM built with text nodes (no `innerHTML`) to prevent XSS.
- **Tests:** vitest + supertest, in-memory SQLite.

## Structure

```
server/
  src/
    app.ts              Express app factory, page routing & server-side page gates
    index.ts            Entry point
    config.ts           Env config
    db/                 Knex setup + migrations
    lib/permissions.ts  ★ Central rank → permission map, canActOn() guard
    lib/session.ts      Sessions, CSRF, requireAuth, requirePermission()
    lib/audit.ts        Audit logger
    routes/             auth, me/profile, admin, games (public + dev), game (game-server API)
    cli/                migrate, create-developer
  tests/                Automated tests
web/
  public/               Public pages, CSS, JS, logo/favicons
  private/              Admin panel + Developer dashboard (served ONLY after a server permission check)
assets/                 Source logo
docs/screenshots/       Screenshots from the Stage 1 check
```

## Ranks & permissions

Ranks are stored on the server and checked on **every** request by `requirePermission()`.
The browser/game client never decides anything; `GET /api/me/permissions` only tells UIs what to *show*.

| Permission | PLAYER | TRUSTED | ADMIN | DEVELOPER |
|---|:-:|:-:|:-:|:-:|
| `items.spawn.approved` | | ✔ | ✔ | ✔ |
| `admin.panel` (web admin page) | | ✔ | ✔ | ✔ |
| `players.view`, `players.ban`, `players.kick`, `moderation.view` | | | ✔ | ✔ |
| `weather.change`, `emergency.trigger`, `emergency.manage`, `admin.commands` | | | ✔ | ✔ |
| `items.spawn.any`, `items.spawn.developer` (fictional dev weapons/abilities) | | | | ✔ |
| `environment.control`, `events.control`, `teleport`, `npc.control` | | | | ✔ |
| `dev.menu`, `dev.commands`, `settings.modify`, `games.manage`, `audit.view` | | | | ✔ |
| `roles.grant.trusted`, `roles.grant.admin`, `roles.grant.developer` | | | | ✔ |

**Protection rules (`canActOn`)**
- Nobody can ban, kick, unban, demote or change the role of a **Developer** through the API (attempts are refused and audit-logged).
- Admins can only act on lower ranks (Players and Trusted), not on other Admins.
- Nobody can act on themselves.
- Only a Developer can grant/revoke Trusted or Admin. Granting **Developer** also requires the Developer to re-enter their password. Removing a Developer is only possible on the server (CLI / database), never from the website.
- The `role` field in sign-up (or profile edit) is ignored/rejected; every new account is PLAYER.
- Banning ends all of the player's website sessions and game tokens; banned accounts cannot log in.

**Rank badges:** DEVELOPER gold (★, glow), ADMIN blue (⛨), TRUSTED green (✔), PLAYER white outline. Names are coloured to match.

**Audit log:** every ban/unban/kick, role change, denied attempt on protected accounts, game control, game publish/edit, upload and sign-up is stored with actor, actor rank, action, target, details, IP and timestamp.

## API (Stage 1)

| Method & path | Who |
|---|---|
| `GET /api/csrf` | anyone (issues CSRF cookie) |
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` | anyone (rate-limited) |
| `GET /api/me`, `GET /api/me/permissions`, `PATCH /api/me` | logged in |
| `GET /api/users/:username` | public profile (no email) |
| `GET /api/admin/users?q=&role=` | `players.view` |
| `POST /api/admin/users/:id/ban` · `/unban` · `/kick` | `players.ban` / `players.kick` + `canActOn` |
| `PUT /api/admin/users/:id/role` `{role, confirmPassword?}` | `roles.grant.*` + `canActOn` |
| `GET /api/admin/moderation` | `moderation.view` |
| `GET /api/admin/audit?category=` | `audit.view` (Developer) |
| `GET /api/games`, `GET /api/games/:slug` | public (published + upcoming only) |
| `GET/POST /api/dev/games`, `PATCH /api/dev/games/:id`, `POST /api/dev/games/:id/publish`, `POST /api/dev/uploads` | `games.manage` (Developer) |
| `POST /api/game/token` | logged-in website session → 10-min game token |
| `POST /api/game/verify` `{token}` + header `X-Game-Server-Key` | game servers → user, role, permissions |
| `POST /api/game/weather` · `/emergency` · `/spawn` · `/teleport` · `/npc` · `/dev-command` | permission-checked, audit-logged **stubs** (no live game yet). Accept a session or `Authorization: Bearer <game token>` |

Games are stored in the database, so publishing or editing a game in the dashboard is live immediately — no site rebuild.

## Pages

- Public: `/` home, `/games`, `/games/:slug`, `/login`, `/register`, `/profile`, `/u/:username`, `/contact`
- `/admin` — staff panel; shows only the controls your rank allows (Trusted: item spawning; Admin: moderation, history, weather, emergencies, approved spawning; Developer: everything + link to dashboard). Players get "No access".
- `/studio-console` — **Developer dashboard** (unlisted; returns 404 to everyone who isn't a Developer): games management + uploads, players & ranks, full audit log, developer tools.

## Production notes

- Serve over HTTPS and set `NODE_ENV=production` (enables `Secure`/`__Host-` cookies, HSTS, upgrade-insecure-requests). Set `TRUST_PROXY=true` behind a reverse proxy so rate limits see real IPs.
- Use Postgres for multi-server deployments; keep `GAME_SERVER_KEY` secret.
- Uploaded images live in `server/uploads` (back these up, or move to object storage later).

## Next stages

1. **Stage 2 — Content:** news/announcements system, contact form (with spam protection), richer profiles (avatars), game version history/changelogs, trailer/video uploads, player statistics in the dashboard.
2. **Stage 3 — Account hardening:** email verification & password reset (needs an email provider), optional 2FA for staff, session list & "log out everywhere", Postgres.
3. **Stage 4 — Game connection:** browser airplane game, real-time game server (WebSocket) using `/api/game/verify`, live kick/weather/emergency/spawn, in-game admin & secret Developer menu, co-op rooms.
4. **Stage 5 — Launch:** hosting, domain, HTTPS, backups, monitoring, real Safari device testing.
