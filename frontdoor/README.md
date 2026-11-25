# Batlas front door

A static page for [Cloudflare Pages](https://pages.cloudflare.com/). Visitors land here instead of on the sleeping Render service. The page shows Sky Crew sneak peeks, polls `https://batlas-2je9.onrender.com/healthz` until the studio answers, then opens the same path on Render.

`https://batlas-szpab.pages.dev/play/sky-crew` becomes `https://batlas-2je9.onrender.com/play/sky-crew`, including the query string. If the studio is already awake, the redirect happens in under a second and the loading screen stays hidden.

The Render address lives in one place: `TARGET_ORIGIN` at the top of `js/door.js`.

## Cloudflare Pages

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Choose the GitHub repository for Batlas and authorize Cloudflare.
3. Production branch: **main**.
4. Framework preset: **None**.
5. Build command: leave it **empty**. There is no build step.
6. Build output directory: **frontdoor**.
7. Save and deploy.

Name the project **batlas-szpab** so the site is [https://batlas-szpab.pages.dev](https://batlas-szpab.pages.dev). `_redirects` sends every path to `index.html`, so shared links such as `/play/sky-crew?room=ABCDE` still show this page and then open that path on the studio.

On the Render service, set:

```
PUBLIC_BASE_URL=https://batlas-szpab.pages.dev
```

Sky Crew room invites then copy that address. Leave `PUBLIC_BASE_URL` empty and invites stay on whatever host the game is open on. `/healthz` already allows `https://*.pages.dev` to read the health check.

## Wrangler

From the repository root, after `npx wrangler login`:

```
npx wrangler pages deploy frontdoor --project-name batlas-szpab --branch main
```

The first run creates the project if it does not exist. Later deploys update it. This is the same folder Pages serves: no build command, output directory `frontdoor`.
