# Batlas front door

Cloudflare Pages project **batlas-szpab**, served at [https://batlas-szpab.pages.dev](https://batlas-szpab.pages.dev).

`frontdoor/_worker.js` is an advanced-mode Pages worker. The browser stays on the Pages host for every page, API call, and WebSocket. The worker reverse-proxies the request to the Render studio at `https://batlas-2je9.onrender.com` and rewrites the response so that host never appears in the address bar:

- Method, path, query, and body are forwarded.
- `Host` is the studio. `Origin` and `Referer` are rewritten when they name this front door, so the studio's same-host checks pass. `X-Forwarded-Host` and `X-Forwarded-Proto` carry the host the browser actually used.
- `Location` and absolute studio URLs in HTML, JSON, CSS, and JavaScript are rewritten back to the Pages origin.
- `Set-Cookie` loses any `Domain` attribute and keeps `Secure`, `HttpOnly`, and `SameSite`, so the session is host-only on pages.dev (including `__Host-` cookies).

`/ws/sky-crew` and `/ws/highcrag` are proxied with the Workers fetch-upgrade pattern: the worker opens a WebSocket to the studio with `Upgrade: websocket`, then bridges it to the browser.

## Asleep studio

A free Render service can answer slowly, or with its own spin-up page, after it has been idle. For a top-level HTML navigation the worker asks the studio for `/healthz` and gives up after about 1.5 seconds. If that check is not `{ "ok": true }`, the worker serves this directory's loading page **without redirecting**. The address stays on pages.dev. The page polls same-origin `/healthz` (which the worker proxies) and, once the studio is healthy, reloads that same URL so the real page loads in place.

Other requests (scripts, images, API calls) are proxied and waited on. They are not replaced with the loading page.

Loading-page CSS, JavaScript, images, and fonts live under `/__door/` so they do not collide with the studio's `/css`, `/js`, `/img`, or `/fonts`.

## Studio settings

On the Render service:

```
PUBLIC_BASE_URL=https://batlas-szpab.pages.dev
```

`TRUST_PROXY` is already on in production. The server allows this origin for WebSocket upgrades, and it trusts `X-Forwarded-Host` only when the value is exactly that host. Secure cookies are set because the browser only talks HTTPS to Pages; the worker does not add a `Domain`.

Sky Crew builds its WebSocket URL from `location.host`, so co-op connects to `wss://batlas-szpab.pages.dev/ws/sky-crew`.

## Deploy

The Pages project is Direct Upload. It has no Git connection, and a Direct Upload project cannot be switched to Git later.

From the repository root:

```
npx wrangler pages deploy frontdoor --project-name batlas-szpab --branch main
```

That needs:

- `CLOUDFLARE_API_TOKEN` with Pages edit permission
- `CLOUDFLARE_ACCOUNT_ID=0f815efd3bb1237f0a34ab980dd48494`

The first run creates the project if it does not exist. Later runs update the production branch. This repository does not deploy itself.

Dashboard drag-and-drop of the `frontdoor` folder does support `_worker.js`. Cloudflare's Direct Upload docs say a `_worker.js` file is deployed by both Wrangler and drag-and-drop. Drag-and-drop does **not** compile a `functions` folder of Pages Functions, which is why this proxy is a single `_worker.js` instead. Prefer the Wrangler command so the worker and the `/__door/` files go up together.

While `_worker.js` is in place it handles every route. `_redirects` and `_headers` are not what sends traffic to the studio.

## Local

Run the studio, then:

```
npx wrangler pages dev frontdoor --binding UPSTREAM_ORIGIN=http://127.0.0.1:3000
```

Leave the binding unset to proxy the live Render origin. `UPSTREAM_ORIGIN` is only a local override; production uses `https://batlas-2je9.onrender.com`.

Header, cookie, and location rewriting is covered by `node --test frontdoor/rewrite.test.js`.
