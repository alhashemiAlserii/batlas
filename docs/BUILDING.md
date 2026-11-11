# Building Batlas apps (PWA, desktop, mobile)

All three are **thin shells around the live site** (`https://batlas-2je9.onrender.com`). Accounts, games, news and Sky Crew all come from the server, so a site deploy updates every app at once; only icon/name/permission changes need a new app build. If the site moves to a custom domain, change the URL in the three places marked below and rebuild.

Tested on the shared Linux box on 2026-11-10 (Debian 13, Node 24). What could and couldn't be built is listed honestly at the end.

## 1. PWA ("Add to Home Screen") — no build step

Shipped with the site (`web/public`):

| File | Purpose |
| --- | --- |
| `manifest.webmanifest` | name/short_name **Batlas**, `start_url` `/`, `scope` `/`, `display: standalone`, theme + background `#020a24` (the site's `theme-color`), shortcuts (Play Sky Crew, Games, News) |
| `img/icons/icon-192.png`, `icon-512.png` | "any" icons, cropped from `assets/batlas-logo.jpg` |
| `img/icons/maskable-192.png`, `maskable-512.png` | Android adaptive/maskable: logo inside the 80% safe circle on `#000f30` |
| `img/icons/apple-touch-icon-180.png` (+ `/apple-touch-icon.png`) | iOS home-screen icon, opaque |
| `sw.js` | service worker, site shell only (below) |
| `offline.html`, `js/offline.js` | friendly offline page; reloads itself when `/healthz` answers again |
| `js/pwa.js` | registers `/sw.js` (scope `/`, `updateViaCache: 'none'`); imported by `js/common.js`, so every page registers it; `maintenance.html` loads it directly |

Every page (public + `/studio-console` + `/admin`) has `<link rel="manifest">`, `apple-touch-icon`, `apple-mobile-web-app-capable=yes`, `mobile-web-app-capable=yes`, `apple-mobile-web-app-title=Batlas`, `apple-mobile-web-app-status-bar-style=black-translucent`. **No Sky Crew file was changed**; the game page is simply never handled by the worker.

Service worker rules (`web/public/sw.js`):
- **Never handled** (the browser talks to the network exactly as without a worker): `/api/*`, `/media/*` (incl. every `Range` request), `/uploads/*`, `/play/**` (Sky Crew + vendor), `/ws/*`, `/healthz`, `/studio-console*`, `/admin*`, `/sw.js`, any non-GET, any cross-origin request (YouTube etc.). WebSockets never pass through a service worker anyway.
- **Network-first** for public pages, `/css/*`, `/js/*`: online users always get the latest deploy; the cached copy is only for offline.
- **Cache-first** for `/img/*`, `/fonts/*`, favicon, manifest.
- Only same-origin `200` responses without `no-store`/`private` are cached. The 503 maintenance page and other errors pass through untouched (a user never sees an old cached page while the site is in maintenance).
- Offline: cached page if visited before, otherwise `/offline.html`.
- Versioning: `VERSION = 'batlas-shell-v1'`; changing it deletes all old caches on the next visit. With network-first this is rarely needed (bump it if the shell's precache list changes).
- Server: `/sw.js` and `/manifest.webmanifest` are sent with `Cache-Control: no-cache`; both, plus `offline.html` and `apple-touch-icon.png`, stay reachable in maintenance mode.

Icons are regenerated with `cd server && npx tsx scripts/make-pwa-icons.ts`.

Installing: **iPhone/iPad Safari** → Share → *Add to Home Screen*. **Android Chrome** → *Install app*. **Desktop Chrome/Edge** → install icon in the address bar. **Mac Safari 17+** → File → *Add to Dock*.

School iPads: if the school's MDM blocks "Add to Home Screen" or the domain, the PWA can't help; the plain site in Safari still works.

## 2. Desktop: Electron (`apps/desktop`)

A locked-down window (`contextIsolation`, `sandbox`, no Node in the page, all permissions except fullscreen refused) that loads the site and opens any other origin (YouTube, links out) in the normal browser. Shows a "Batlas is unreachable" page if the network is down.

```bash
cd apps/desktop
npm install
npm start                                   # dev run (needs a display)
BATLAS_URL=http://127.0.0.1:3400 npm start  # against a local server
npm run dist:linux                          # → dist/Batlas-1.0.0.AppImage + dist/batlas-desktop-1.0.0.tar.gz
npx electron-builder --win zip              # → dist/Batlas-1.0.0-win.zip (unsigned)
npm run dist:win                            # NSIS installer: needs Windows or wine
npm run dist:mac                            # dmg: needs a Mac
```
Site URL: `SITE` default in `apps/desktop/main.js`.

**Tauri** would give a much smaller app (~5–10 MB instead of ~110 MB) using the OS webview (WebKitGTK on Linux, WebView2 on Windows, WKWebView on macOS). Not tried here: it needs the WebKitGTK development packages and the box's apt mirror was returning HTTP 500 (Rust/cargo is installed). Electron was chosen because it builds here without system packages and renders identically everywhere (Chromium).

## 3. Mobile: Capacitor (`apps/mobile`)

Capacitor 8 project with `server.url` = the live site (`capacitor.config.json`, `allowNavigation` limited to that host, no cleartext). `www/index.html` is only a "Loading…" placeholder. App id `com.batlas.app`, name *Batlas*. Icons and splash screens generated from the logo (`assets/*.png`, `npx @capacitor/assets generate --iconBackgroundColor '#000f30' --splashBackgroundColor '#020a24'`).

```bash
cd apps/mobile
npm install
npx cap sync                     # after any config change
# Android (needs JDK 21 + Android SDK platform 36 / build-tools 36):
export JAVA_HOME=… ANDROID_HOME=…
cd android && ./gradlew assembleDebug      # → android/app/build/outputs/apk/debug/app-debug.apk
#   release: ./gradlew bundleRelease + a signing key (keystore) → .aab for Google Play
# iOS (Mac only):
npx cap open ios                 # opens Xcode; set the Team, then Run / Archive
```

App-store notes (Apple App Review Guidelines, opened 2026-11-10: <https://developer.apple.com/app-store/review/guidelines/>):
- **4.2 Minimum Functionality**: "Your app should include features, content, and UI that elevate it beyond a repackaged website." A pure `server.url` wrapper is at real risk of rejection; native value (push notifications, offline content, Game Center, etc.) would be needed before submitting.
- **5.1.1(v)**: apps that support account creation "must also offer account deletion within the app". Today accounts can only be deleted by staff with the `players.delete` permission (`DELETE /api/admin/users/:id`); a player self-delete would be needed before an App Store submission.
- Both stores need developer accounts (not set up; fees not checked here). Google Play is generally less strict about web wrappers, but its policies were not reviewed for this note.

## What was actually built on this box (2026-11-10)

| Target | Result |
| --- | --- |
| PWA | ✅ vitest (`server/tests/pwa.test.ts`, 6 tests) + Playwright `e2e/pwa.mjs`: **72/72** checks in Chromium (desktop, iPhone) and WebKit (iPhone, iPad, desktop): manifest valid, worker registered at `/` and controlling the page, **Chromium reports zero installability errors**, `/api/me` never served by the worker (positive control: `/css/site.css` *is*), cache contains only shell files (15 entries, none under `/api` `/media` `/play` `/ws` `/admin`), Sky Crew page not served or cached by the worker, offline → offline page, cached homepage opens offline, `/api` offline is a network error. Results + screenshots: `docs/screenshots/pwa/`. |
| Electron Linux | ✅ `dist/Batlas-1.0.0.AppImage` (≈116 MB) and `.tar.gz` (≈109 MB) built; the packaged binary was launched under Xvfb via Playwright, loaded the site (title "Batlas — Games Studio"), page has no Node access (`typeof require` = undefined). Screenshot `docs/screenshots/pwa/electron-linux.png`. On this box it had to run with `--no-sandbox` (the unpacked `chrome-sandbox` isn't setuid root here); a normal AppImage install doesn't need that. |
| Electron Windows | ⚠️ `Batlas-1.0.0-win.zip` built **unsigned** and **not run** (no Windows here). Windows SmartScreen will warn until it is code-signed (needs a paid certificate). NSIS installer needs wine/Windows. |
| Electron macOS | ❌ needs a Mac (and an Apple Developer ID to sign + notarize, otherwise Gatekeeper blocks it). |
| Android (Capacitor) | ✅ `npx cap add android` + `./gradlew assembleDebug` → `app-debug.apk` (≈6.6 MB, `com.batlas.app`, min SDK 24, target 36, Batlas icons). Built with Temurin JDK 21 + Android cmdline-tools/SDK downloaded into `/workspace/batlas-wrappers/tools/` (outside the repo; SDK licences accepted for that install). **Not run on a device or emulator** (an emulator would need a ~1.5 GB system image and ~2 GB RAM on the shared box). Debug build only: a release build needs a signing keystore. |
| iOS (Capacitor) | ⚠️ `npx cap add ios` worked (Xcode project + Swift Package Manager, icons/splash set) but **cannot be built here**: needs a Mac with Xcode, and an Apple Developer account to install on devices or ship. |
| Tauri | not attempted (see above). |

Build outputs are **not committed** (`apps/*/.gitignore`: `node_modules`, `dist`, Android `build`, `*.apk`). Copies are on the box in `/workspace/batlas-wrappers/artifacts/` (AppImage, tar.gz, win zip, debug APK).
