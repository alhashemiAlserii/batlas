# Batlas — Studio Website, Platform & Sky Crew (Stages 1–3)

The official Batlas website, shared player accounts, rank system and Developer dashboard.
One account works across every Batlas game; game servers (starting with the co-op airplane
game) will authenticate players against this backend.

## Quick start

```bash
cd server
npm install
cp .env.example .env            # set GAME_SERVER_KEY to a long random value
npm run migrate                 # creates data/studio.sqlite
npm run create-developer -- --username abood   # --email is optional
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
| `npm run test:pg` | Same tests against Postgres (`TEST_DATABASE_URL`, default `postgres://batlas:localtest@127.0.0.1:5433/batlas_test`) |
| `npm run backup [-- --out file.json]` | Dump every table to JSON from `DATABASE_URL` (or the SQLite file). Contains password hashes: keep private |
| `npm run restore -- --file f.json [--dry-run] [--force --confirm <db>]` | Restore a backup into `DATABASE_URL` (or the SQLite file): migrates first, refuses a non-empty DB unless `--force` + typed DB name, one transaction, fixes sequences. See [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md) |
| `cd e2e && npm i && npx playwright install webkit && npm run webkit` | Optional Safari (WebKit) end-to-end check against the running server (creates a throwaway `webkit_*` user and contact messages) |

## Stack

- **Backend:** Node.js 24, TypeScript (run with `tsx`), Express 5
- **Database:** **Knex** with in-code migrations (`server/src/db/migrations`). **Postgres** when `DATABASE_URL` is set (production / Render), otherwise a local SQLite file. Both run the same migrations and the same test suite (`npm run test:pg`).
- **Auth:** argon2id hashing (`@node-rs/argon2`), opaque session tokens in an httpOnly, SameSite=Lax cookie (only a SHA-256 of the token is stored), `Secure` + `__Host-` prefix in production, double-submit CSRF token on every state-changing request, `express-rate-limit` on login/register, `zod` validation, `helmet` security headers incl. a strict CSP (no inline scripts/styles).
- **Frontend:** dependency-free HTML/CSS + ES modules in `web/` (no build step). Responsive, safe-area aware for iPhone; all DOM built with text nodes (no `innerHTML`) to prevent XSS.
- **Tests:** vitest + supertest, in-memory SQLite (or a throw-away schema per test file in Postgres with `TEST_DATABASE_URL`).

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
| `news.manage`, `inbox.view`, `stats.view` (Stage 2) | | | | ✔ |
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

### Stage 2 API

| Method & path | Who |
|---|---|
| `GET /api/news?limit=`, `GET /api/news/:slug` | public (published only; pinned first) |
| `GET/POST /api/dev/news`, `PATCH /api/dev/news/:id`, `POST /api/dev/news/:id/status` `{status: draft\|published}`, `POST /api/dev/news/:id/pin` `{pinned}` | `news.manage` |
| `POST /api/contact` `{name,email,subject,message,website?}` | public; CSRF + rate limit (5/hour/IP) + honeypot (`website` must be empty; bots get a fake success and nothing is stored) |
| `GET /api/dev/inbox?status=new\|read\|archived`, `PATCH /api/dev/inbox/:id` `{status}` | `inbox.view` |
| `POST /api/auth/verify-email/request` (logged in), `POST /api/auth/verify-email/confirm` `{token}` | email verification (24 h tokens) |
| `POST /api/auth/password/forgot` `{email}` | always answers the same (no account enumeration); 1 h reset token |
| `POST /api/auth/password/reset` `{token,password}` | single-use; signs out every session & game token |
| `POST /api/me/password` `{currentPassword,newPassword}` | logged in; signs out all other devices, keeps this one with a fresh session |
| `POST /api/me/avatar` (multipart `file`), `DELETE /api/me/avatar` | logged in; PNG/JPEG/WebP/GIF ≤ 2 MB, content-sniffed, re-encoded to 256×256 WebP with all metadata stripped (sharp) |
| `GET /api/dev/games/:id/versions`, `POST /api/dev/games/:id/versions` `{version,releasedAt,changelog,downloadUrl?}`, `DELETE …/versions/:vid` | `games.manage`; newest release becomes the game's current version. Public game detail includes `versions` + `latestVersion` |
| `GET /api/dev/stats` | `stats.view`: totals, sign-ups 7/30 days + daily series, users by rank, active sessions, bans, logins, unread messages |

**Tokens** (verify email / reset password) are 256-bit random values; only their SHA-256 is stored, each is bound to a purpose and the email it was sent to, expires (24 h / 1 h), is consumed atomically (single use), and issuing a new one revokes older unused ones.

**Mailer:** `server/src/lib/mailer.ts` defines a `Mailer` interface. The default `FileMailer` writes each email as an `.eml` file into `server/data/outbox/`; **nothing is ever sent**. To go live, add an SMTP/Resend/SES implementation and pass it to `createApp`. Set `PUBLIC_URL` so links in emails point at the real domain.

Games are stored in the database, so publishing or editing a game in the dashboard is live immediately — no site rebuild.

## Pages

- Public: `/` home (latest announcements), `/games`, `/games/:slug` (latest version + changelog + version history), `/news`, `/news/:slug`, `/contact` (form), `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/profile`, `/u/:username`, `/settings` (avatar, change password, email verification)
- `/admin` — staff panel; shows only the controls your rank allows (Trusted: item spawning; Admin: moderation, history, weather, emergencies, approved spawning; Developer: everything + link to dashboard). Players get "No access".
- `/studio-console` — **Developer dashboard** (unlisted; returns 404 to everyone who isn't a Developer). Tabs: Stats (cards + 30-day sign-up chart + accounts by rank), Games (edit, publish, uploads, version history), News (create/edit/publish/unpublish/pin), Inbox (contact messages: mark read/unread, archive/restore), Players & ranks, Audit log, Developer tools.

## Production notes

- Serve over HTTPS and set `NODE_ENV=production` (enables `Secure`/`__Host-` cookies, HSTS, upgrade-insecure-requests). Set `TRUST_PROXY=true` behind a reverse proxy so rate limits see real IPs.
- Use Postgres (`DATABASE_URL`) in production; keep `GAME_SERVER_KEY` secret.
- Uploaded images live in `server/uploads` (back these up, or move to object storage later).
- Health check: `GET /healthz` → `{"ok":true}` (pings the DB; no cookies).

## Deploying to Render (free plan)

`render.yaml` is a Blueprint: one free web service **batlas** (Frankfurt, Node 24; website + API + Sky Crew WebSocket server in one process on `$PORT`, browsers connect with `wss://<same host>/ws/sky-crew`) and a free Postgres **batlas-db** wired in as `DATABASE_URL`. `GAME_SERVER_KEY` and `SESSION_SECRET` are generated by Render. Migrations run automatically at start.

1. Render Dashboard → **New → Blueprint** → pick this repo → Apply. Render asks for the two `sync: false` values:
   - `BOOTSTRAP_DEVELOPER_PASSWORD` — a strong password (10+ chars). On boot, if no Developer exists yet, the server creates **abood** with it (no email; optional `BOOTSTRAP_DEVELOPER_USERNAME` / `BOOTSTRAP_DEVELOPER_EMAIL`) and forces a password change at first sign-in. Once a Developer exists the variable is ignored — delete it afterwards.
   - `PUBLIC_URL` — can be left empty at first; then set it to `https://<service>.onrender.com` (or your domain). Only used for links in emails.
2. Wait for the deploy to go live (`/healthz` returns `{"ok":true}`), sign in as abood, choose the new password, then delete `BOOTSTRAP_DEVELOPER_PASSWORD` from the service's Environment.
3. Backups: copy the database's **External Database URL** and run `DATABASE_URL='<external url>' npm run backup` from `server/` on your computer (TLS is switched on automatically for non-internal hosts; override with `DATABASE_SSL=true|false`).

Free-plan limits: the service sleeps after ~15 minutes idle (first request then takes ~1 minute, and live co-op rooms are lost on sleep, restart or redeploy), the disk is ephemeral (uploaded avatars/images vanish on every redeploy, restart or spin-down — move uploads to object storage before relying on them), and the free Postgres expires 30 days after creation (then 14 days to upgrade before it is deleted).

## Accounts without email (school iPads)

Email is **optional** everywhere (`EMAIL_ENABLED=false` by default):

- Register with **username + password** only; email sits behind "Add email (optional)". Log in by username (or email if one was added).
- Nothing requires verification. With email off, `/api/auth/verify-email/*` and `/api/auth/password/*` answer `404 email_disabled`, and `/forgot-password` says "Ask a Batlas admin".
- **Staff password reset:** in `/admin` or `/studio-console` → Users → **Reset password**. Developers can reset anyone below them. Admins can reset Trusted and Player accounts, but not Admins or the Developer. The server issues a one-time temporary password (`xxxx-xxxx-xxxx`, shown once). It signs the user out everywhere and forces a password change at the next login. Every reset is written to the audit log (`player.password_reset`).
- Set `EMAIL_ENABLED=true` (plus a real mailer) later to switch the email verification and reset links back on.

## Sky Crew (Stage 3: playable early build)

Play at **`/play/sky-crew`**. The game page `/games/sky-crew` stays *Upcoming* and shows a **▶ Play early build** button. Everything is vendored and works offline: Three.js r187 and cannon-es 0.20 live in `web/public/play/vendor/`, all art is procedural low-poly, and nothing loads from a CDN.

**Loop:** load the 8 bags from the cart up the cargo stairs into the hold. The 10 passengers walk up the front stairs to their seats on their own; just keep the front door open. Close the doors, take the captain's seat and throttle up. Departing closes any open door (with a penalty) and removes the stairs. Bags still outside and passengers not yet aboard are left behind. Fly about 17 km to **Coral Point (CRP)** and land. During the flight, serve requests from the galley (water, snack, blanket), calm complaints, and fix engine and cabin-pressure warnings at the maintenance panel in the hold. Turbulence shakes the cabin, and loose bags fly around. Bags slide aft when you climb. The results screen scores bags, passengers, service, fixes, landing quality, happiness and time (0–5★).

**Controls:**
- **Walking:** WASD to move, mouse to look (click to lock the pointer, or drag), Shift to sprint, Space to jump, **E** to interact (pick up or place, doors, galley, panel, serve, pilot seat), **Q** to throw, **V** for first or third person, **Esc** to pause, **F2** for staff tools.
- **Pilot:** R/F for throttle, W/S for pitch, A/D to bank (or steer on the ground), X to leave the seat. If nobody is in the seat, the autopilot holds the plane level, so the pilot can go help in the cabin.
- **Touch (phones and iPads):** left stick to move, drag on the right side to look, plus E, jump and camera buttons. Seated pilots also get THR+ and THR− buttons. A 💦 button appears with the Wave Cannon.

**Files:** `web/public/play/sky-crew/`:
- `index.html` and `game.css`
- `events.json`: random events with weight, phases, duration, timeout and cooldown. Edit it to tune the game without touching code.
- `js/world.js`: aircraft with colliders, airports and scenery
- `js/sim.js`: luggage physics, passengers and personalities, events, phases and scoring
- `js/flight.js`: arcade flight model
- `js/characters.js`: low-poly people, name tags and request bubbles
- `js/net.js`: co-op client
- `js/ui.js`: HUD and staff overlay
- `js/main.js`: input, character controller, cameras and glue

The design notes are in `docs/sky-crew-design.md`.

### Co-op

- **Game server:** `server/src/game-server/` runs a WebSocket server at `/ws/sky-crew` on the same port. It is enabled when `GAME_SERVER_KEY` is set in `server/.env`.
- **Sign-in:** the browser gets a 2-minute single-use token from `POST /api/game/token` (website session plus CSRF). The game server checks that token with `POST /api/game/verify` using `X-Game-Server-Key`. **Name, rank and permissions come only from that check.** Anything the client claims is ignored.
- **Rooms:** rooms use 5-letter codes and hold up to 8 players.
- **Roles:**
  - The room creator is the **host** and runs the simulation (luggage physics, passengers, events), sending world snapshots about 10×/s.
  - The seated **pilot** owns the aircraft state at 15 Hz.
  - Other players send actions (grab, drop, serve, door, fix) to the host.
  - If the host leaves, the longest-connected player takes over.
- **Display:** names and rank badges float over heads in the rank colours: Developer gold, Admin blue, Trusted green, Player white.
- **Guests (not signed in):** can play solo. Co-op and staff tools need a Batlas account (username only).
- **How to test co-op:** sign in with two different accounts in two browsers, or one normal and one private window. Open `/play/sky-crew`. In one, click **Create co-op room** and read the code at the top right. In the other, type that code and click **Join**. You can also use `/play/sky-crew?room=CODE`.

### In-game staff tools (F2 or the 🛠 Staff button, in a co-op room)

The overlay shows only the tools your rank allows. **The game server re-checks every command against the central permission map, and `canActOn` decides who can act on whom.** Every command is written to the site audit log as `ingame.*` (kicks under *moderation*).

| Rank | Tools |
|---|---|
| Trusted | spawn approved items (suitcase, duffel, water, snack, blanket) |
| Admin | + kick players (never the Developer, never equal or higher ranks), weather clear/storm, emergency scenarios (engine failure, severe turbulence, cabin pressure, emergency landing) start/stop |
| Developer | everything + fun items (beach ball, giant duck, traffic cone), teleport self/players, NPC control (sit/dance/panic/calm), **Wave Cannon**: a fictional splash cannon that knocks loose luggage away |

## Sky Crew v0.4 (Stage 4)

- **Look:** a new low-poly airliner, built from merged vertex-coloured batches so each part is one draw call. It has:
  - a rounded fuselage with a tapered nose and tail cone, and a cockpit windshield
  - swept wings with engines and winglets, and the Batlas wave livery on the tail
  - a cabin with shaped seats, overhead bins, a curved ceiling, window frames, patterned carpet and a galley
  - low-poly passengers with hair variations and walk/sit/panic/flail animations

  Around the plane: hemisphere light, a sun with soft shadows that follows the plane, a sky gradient, fog, clouds, airports with terminal, tower, hangar, vehicles and approach lights, and an ocean.
- **Quality:** Settings → Graphics: Auto / Low / Medium / High. Auto picks Medium on iPads and phones (1024 shadow map, no MSAA) and High on desktops. Low turns shadows off and uses pixel ratio 1.
- **Sound:** all sound is generated with WebAudio; there are no audio files. It includes:
  - engine hum and whine that follow the throttle, the takeoff roar, and a touchdown thump or crash
  - cabin air and rain/thunder ambience
  - a chime for announcements and the seatbelt sign, plus gear, doors, pickup/drop and UI clicks
  - a looping pad and arpeggio in the menus

  Master, music and effects sliders are in Settings. Audio unlocks on the first tap or key press, as iOS requires.
- **Routes:** Coral Point (CRP, tropical lagoon), Dune Bay (DNB, desert, a short hop) and Pine Ridge (PNR, mountains, a long flight). Each has its own scenery, and fog, sky and sea colours that blend in on approach. Hills and peaks count as terrain for crashes, but direct routes and final approaches are kept clear.
- **Crew roles (co-op lobby):** Pilot, Co-pilot, Cabin crew and Cargo. The server allows only one Pilot and one Co-pilot. Each job gets its own task list in the HUD.
  - The co-pilot seat (right seat, E) controls the cabin lights (L), the seatbelt sign (B), announcements (N) and the landing gear (G).
  - The pilot can use the same keys. The galley PA handset also makes announcements.
- **Pre-flight checklist:** bags loaded, passengers seated, doors closed, seatbelt sign on, welcome announcement, and gear down with lights on. Completing all of it earns an insurance discount.
- **Landing guide:** within 10 km of the destination, a panel shows four PAPI lights (2 white + 2 red means on the 3° slope), a vertical deviation dot, a lateral centreline dot and a GEAR warning. Landing with the gear up is a belly landing.
- **Passenger chaos:**
  - With empty hands, press E on a passenger to pick them up. They flail, get angry, and nearby passengers panic.
  - E puts them down; Q throws them. A thrown passenger lands, complains, and walks back to their seat.
  - Doors can now be opened in flight, which makes everyone panic. A passenger who goes out of an open door while airborne pops a cartoon parachute and floats away. They are counted as lost: you pay a refund plus a safety fine, and the rating is capped at 2★.
  - The Developer can respawn lost passengers (F2 → Passengers → Respawn).
  - All of this is host-authoritative. Guests predict their own pickups and throws.
- **Payout instead of score:** after the flight the airline gets paid in credits (₵). The breakdown shows:
  - Earnings: fares per passenger delivered (scaled by route length), cargo fees for intact bags, and service tips per passenger. Food, drink and a smooth ride (mood ≥ 60): 2 of 3 is good service, 3 of 3 is excellent.
  - Bonuses: repairs, landing quality and on-time delivery.
  - Charges: vouchers for ignored requests, damaged-luggage claims (thrown bags, loose bags, hard landings), refunds for passengers left at the gate, parachute refunds and fines, door fines, crash or belly-landing bills.
  - A **Premium contract** pays ×1.6 but doubles the fines.

  The leaderboard ranks the best single-flight payout.
- **Stats:** each signed-in player's browser reports its own result when the payout screen appears (`POST /api/game/sky-crew/flights`, session + CSRF, clamped values, at most 1 per 30 s). Profiles show flights, best payout, safe landings, butter landings and crashes (`GET /api/users/:username/game-stats`). The game page shows the top 10 (`GET /api/games/sky-crew/leaderboard`, banned users hidden). **This is an honour system:** the browser reports the numbers, so a determined player could fake a payout.
- **Host hand-over:** world snapshots now carry the full flight state: score, event timers, passenger timers, cabin systems, route and contract. If the host leaves, the next player continues the same flight without a reset. Passenger looks come from the room seed, so every client sees the same people.
- **Rooms:** the host can lock the lobby (🔓/🔒).
- **Developer access to rooms:** the game server checks the verified rank on the socket's game token; it never trusts anything the client says.
  - Only the Developer can list every live room (code, host, players, route, status), from the Developer dashboard → **Live rooms** or in-game F2 → Live rooms.
  - The Developer can join any room, including full (past the 8-player cap) and locked rooms.
  - An optional **hidden** join makes the Developer an invisible spectator: left out of other players' lists, no movement broadcast, no world actions.
  - The Developer cannot be kicked.
  - Every Developer join is audit-logged as `ingame.dev.join`, with what was bypassed.
  - Admins and Players keep the normal full/locked rules.

## Website upgrade (branch `website-upgrade`)

**Homepage:** branded hero with Play / Browse / Create-account buttons, a **featured game** (the one marked *Featured* in the dashboard, else the newest released game) with a muted `playsinline` autoplay trailer preview, **Coming soon** cards with release date + countdown, **Latest news** cards, and a sign-up band (hidden when signed in). A site-wide **event banner** (see Events) shows on every page, below the sticky header, at most two at a time, dismissible.

**Game pages:** media box with tabs for the uploaded **MP4 trailer** (`controls playsinline preload=metadata` + poster), a **YouTube** embed (`youtube-nocookie.com`, `playsinline=1`) and the cover; **screenshot gallery** with a touch-friendly **lightbox** (swipe left/right, swipe down to close, arrow keys, Esc, buttons); **Play in browser** (hidden and replaced by a notice when the game's *Play enabled* setting is off); **Download** only when the server confirms the file exists (external http(s) link, an existing `/media/:id`, or a real file under `web/public`) and downloads are enabled; **Upcoming** pill + release date; latest changelog, version history, news linked to the game, and the Sky Crew leaderboard (per-game setting).

**Developer dashboard (`/studio-console`) additions:**

| Tab | What it does |
|---|---|
| Games | Edit everything incl. description, release date, cover/screenshot/poster/trailer **uploads with progress**, screenshot reorder/remove, YouTube link, play/download URLs and **per-game settings** (featured, play enabled + message, downloads enabled, leaderboard). **Publish update** = new version + changelog, optionally also published as a news post linked to the game. |
| Players & ranks | Existing ban/unban/kick/temp-password/delete/rank controls, plus **Edit profile** (reset display name / clear bio) and *last seen*. Rank changes keep the existing server rules (only the Developer grants Trusted/Admin/Developer; Developer needs password re-entry; Developers can never be demoted, banned, kicked or edited from the website). |
| Online | Signed-in users seen in the last 5/15/60 min (auto-refresh) + **live Sky Crew rooms** read from the in-process game server (read-only snapshot taken in `index.ts`; the game server code is untouched). |
| Events | Schedule / edit / cancel / restore / delete site-wide event banners (show-from, start, end, style, link). |
| Media | Database media library: upload, copy URL, delete; shows total stored bytes. |
| Maintenance | Maintenance mode switch + message + ETA (see below). |

### Uploads are stored in the database

Render's free plan wipes the disk on every deploy, so uploaded **images, trailers and avatars** now go into the `media` table (`bytea` on Postgres, `blob` on SQLite) and are served from `GET /media/:id.ext` with the stored `Content-Type`, `ETag`/304, `Cache-Control: public, max-age=31536000, immutable` (rows are never changed in place), `HEAD`, and **HTTP Range** (`206`, suffix and open ranges, `416`; a single response is capped at 4 MB and the player asks for the rest). Bytes are read in 1 MB slices with `substring()`/`substr()`, so a request never loads a whole trailer into memory. Caps: images **5 MB**, trailers **40 MB** (MP4 only, content-sniffed), avatars 2 MB (re-encoded 256 px WebP as before). The old `POST /api/dev/uploads` still works but now stores in the DB too. Existing `/uploads/...` files keep being served for old links.

Things to know: a 40 MB upload is held in memory while it is processed; Render's free Postgres has a **1 GB storage limit**, so a handful of trailers uses a real share of it (the dashboard shows the total); and `npm run backup` / `GET /api/internal/backup` now include media as base64 (`{"$base64": …}`), so backups get bigger.

### Maintenance mode

- Switch: Developer dashboard → **Maintenance** (`PUT /api/dev/maintenance {enabled, message?, eta?}`, permission `site.maintenance`, Developer only, audit-logged as `maintenance.on/off/update`). Stored in `site_settings` (key `maintenance`).
- `MAINTENANCE_MODE=true` env var **forces it on** (the dashboard then shows it as forced and cannot switch it off).
- While on, everyone except a signed-in **Developer** gets the branded maintenance page (HTTP 503, `Retry-After`) for every page and `503 {code: "maintenance"}` for the API. Login and register return 503 for non-Developers (login checks the password first, so it reveals nothing), as does `POST /api/game/token`; existing non-Developer sessions are blocked too. Still open: `/healthz`, `/api/internal/backup`, static assets, `/media`, `/login` (so the Developer can sign in), `GET /api/maintenance`, `GET /api/csrf`, `GET /api/site`, logout, and the server-to-server `POST /api/game/verify` / `/api/game/audit`.
- **Hook for other servers in the process (e.g. the Sky Crew WebSocket server):**

  ```ts
  import { isMaintenance, maintenanceBlocks, getMaintenance } from '../lib/maintenance.js';
  await isMaintenance(db);                 // boolean: env override OR dashboard switch
  await maintenanceBlocks(db, user.role);  // true if this role must be kept out (DEVELOPER → always false)
  await getMaintenance(db);                // { on, forced, enabled, message, eta, updatedAt }
  ```
  Reads are cached for 5 s per DB handle (`CACHE_MS`); toggling from the dashboard clears the cache at once. The game server is **not** hooked in yet: `POST /api/game/verify` still verifies tokens during maintenance, so the game worker should call `maintenanceBlocks()` on connect (and optionally drop non-Developer sockets when it turns on).

### New API

| Method & path | Who |
|---|---|
| `GET /media/:id[.ext]` | public (Range, ETag, long cache) |
| `POST /api/dev/media` (multipart `file`, optional `gameId`), `GET /api/dev/media?gameId=`, `DELETE /api/dev/media/:id` | `media.upload` (Developer) |
| `GET /api/events/active` | public |
| `GET/POST /api/dev/events`, `PATCH/DELETE /api/dev/events/:id` | `site.events` (Developer) |
| `GET /api/admin/online?minutes=` | `players.online` (Admin+; rooms only for the Developer) |
| `PATCH /api/admin/users/:id/profile` `{displayName?, bio?}` | `players.edit` (Admin+) + `canActOn` |
| `GET /api/maintenance` | public · `GET/PUT /api/dev/maintenance` → `site.maintenance` (Developer) |

Game objects gained `releaseDate`, `trailerVideo`, `trailerPoster`, `youtubeUrl`, `settings`; the public game detail also has `download` (only set when the file exists) and `news`. News posts gained an optional `gameId`.

New permissions: `players.edit`, `players.online` (Admin + Developer), `media.upload`, `site.events`, `site.maintenance` (Developer). Migration **`005_website`** adds `media`, `site_settings`, `site_events`, `users.last_seen_at` (written at most once a minute per user), `news_posts.game_id` and the new `games` columns. It runs automatically at start-up (`migrate()` in `index.ts`).

### Tests

- `cd server && npm test` (SQLite) and `npm run test:pg` (Postgres): `tests/website.test.ts` (media/Range/caps, game fields, downloads, events, online, profile moderation, role rules) and `tests/maintenance.test.ts` (toggle permissions, env override, 503s, Developer bypass, healthz/backup exemptions, cache).
- `e2e/website.mjs`: Playwright, drives every new dashboard control through the UI, then checks the public site in **Chromium + WebKit** at **iPhone 15, iPad (gen 7) and 1440×900**; screenshots in `docs/screenshots/website/` (results in `RESULTS.txt`). Run against a throw-away server: `BASE=http://localhost:3300 DEV_CREDS=../server/data/dev-creds.txt node website.mjs`. WebKit here has no GStreamer codecs, so WebKit runs skip the uploaded `<video>` (it crashes that renderer); trailer playback is verified in Chromium and by the Range tests. A check on a real iPhone/iPad is still recommended.

## Browser testing

- Automated API tests: `cd server && npm test`.
- Safari: `e2e/webkit-check.mjs` runs Playwright **WebKit** (Safari's engine) on desktop and on an iPhone 15 profile. It covers:
  - every public page and the contact form (email optional)
  - sign-up with username and password only, then avatar upload and password change
  - login by username and the "Ask a Batlas admin" hint
  - a staff temporary-password reset, then the forced password change
  - the Developer dashboard tabs and the mobile menu

  It also flags console errors and horizontal overflow.
- Game: `e2e/sky-crew.mjs [chromium|webkit|coop|all]` runs in Chromium and WebKit, on desktop and on mobile (Pixel 7 and iPad). It loads the game, checks for console errors, walks, picks up a bag, carries it up the stairs into the hold, takes the pilot seat, takes off, lands at CRP and reaches the results screen. It also serves a passenger, fixes an engine warning, and tests the touch joystick. The co-op part joins two signed-in clients (Developer and Player) to one room and checks that they see each other, that positions, world and held items sync, and that staff tools are gated. Run it with `ln -s <playwright node_modules> e2e/node_modules`. Stage 4 adds checks for the payout screen, settings, routes, the co-pilot checklist, gear, the landing guide, passenger carry/throw/parachute, crew roles, locked rooms, seeded passenger looks, host hand-over, saved stats and the leaderboard, and Developer live-room hidden join. Screenshots go to `docs/screenshots/stage4/` (Stage 3 shots are kept in `docs/screenshots/stage3/`). This is WebKit on Linux, not real Safari on Apple hardware, so a final check on a real iPhone/Mac is still recommended.

## Next stages

1. ~~Stage 2 — Content~~ ✅ news, contact inbox, email verification, password reset/change, avatars, version history, stats.
2. ~~Stage 3 — Sky Crew v0~~ ✅ (see above). Original plan: a Three.js game served at `/play/sky-crew`, signed in through `/api/game/token`; a small authoritative WebSocket game server that checks every player with `/api/game/verify`; single-plane co-op room with basic flight, cabin walk-around, luggage physics and turbulence; in-game rank badges and an admin overlay wired to the existing weather/emergency/spawn/kick endpoints.
3. ~~Stage 4 — Sky Crew v0.4~~ ✅ (see above).
4. **Stage 5 — Account hardening & launch prep:** real email provider, optional 2FA for staff, "log out everywhere" / session list, Postgres, hosting + domain + HTTPS, backups and monitoring, real-device Safari testing.
