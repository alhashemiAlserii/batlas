/**
 * Cloudflare Pages advanced-mode worker.
 * Every request stays on this host. The Render origin is only the upstream.
 *
 * Deploy (Direct Upload, from the repo root):
 *   npx wrangler pages deploy frontdoor --project-name batlas-szpab --branch main
 */

/** Production studio. Override locally with the UPSTREAM_ORIGIN binding. */
const PRODUCTION_UPSTREAM = 'https://batlas-2je9.onrender.com';

/** Loading-page files live here so they never collide with the proxied site. */
const DOOR_PREFIX = '/__door/';

/** How long a top-level navigation waits for /healthz before showing the loading page. */
const HEALTH_TIMEOUT_MS = 1500;

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'];

function upstreamOrigin(env) {
  const raw = (env && env.UPSTREAM_ORIGIN) || PRODUCTION_UPSTREAM;
  return String(raw).replace(/\/+$/, '');
}

function isWebSocketUpgrade(request) {
  return (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
}

/**
 * A real page load, not a fetch() of an asset or API. Sec-Fetch-Dest/Mode is the
 * signal modern browsers send. Older clients are included only when they ask for HTML.
 */
function isTopLevelHtmlNavigation(request) {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const dest = (request.headers.get('sec-fetch-dest') || '').toLowerCase();
  const mode = (request.headers.get('sec-fetch-mode') || '').toLowerCase();
  if (dest === 'document' || dest === 'iframe') return true;
  if (mode === 'navigate' || mode === 'nested-navigate') return true;
  if (dest || mode || request.headers.get('sec-fetch-site')) return false;
  const accept = request.headers.get('accept') || '';
  const first = accept.split(',')[0].trim().toLowerCase();
  return first.startsWith('text/html');
}

function textualContentType(type) {
  const value = (type || '').split(';')[0].trim().toLowerCase();
  if (value.startsWith('text/')) return true;
  return [
    'application/javascript',
    'application/x-javascript',
    'application/json',
    'application/xml',
    'application/xhtml+xml',
    'application/manifest+json',
    'application/ld+json',
    'image/svg+xml',
  ].includes(value);
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace absolute upstream URLs (and protocol-relative ones) with the browser's origin.
 * The host must end at a boundary so `host` does not match `host.evil` or a longer port.
 */
function rewriteUpstreamUrls(text, upstreamOriginValue, publicOrigin) {
  if (!text) return text;
  const origins = [...new Set([upstreamOriginValue, PRODUCTION_UPSTREAM].filter(Boolean))];
  let out = String(text);
  let pub;
  try { pub = new URL(publicOrigin); } catch { return out; }
  for (const origin of origins) {
    let upstream;
    try { upstream = new URL(origin); } catch { continue; }
    if (upstream.host.toLowerCase() === pub.host.toLowerCase()) continue;
    const host = escapeRegExp(upstream.host);
    const re = new RegExp(`(https?:|wss?:)?//${host}(?![\\w.-])`, 'gi');
    out = out.replace(re, (_match, scheme) => {
      if (!scheme) return `//${pub.host}`;
      const s = scheme.toLowerCase();
      if (s === 'ws:' || s === 'wss:') return `${pub.protocol === 'https:' ? 'wss:' : 'ws:'}//${pub.host}`;
      return pub.origin;
    });
  }
  return out;
}

/** Drop any Domain attribute so the cookie is host-only on the front door. Secure, HttpOnly, and SameSite stay. */
function rewriteSetCookie(cookie) {
  if (!cookie) return cookie;
  const parts = String(cookie).split(';');
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (!trimmed) continue;
    if (i > 0 && /^domain\s*=/i.test(trimmed)) continue;
    kept.push(trimmed);
  }
  return kept.join('; ');
}

function sameHost(value, incomingOrigin) {
  try { return new URL(value).host.toLowerCase() === new URL(incomingOrigin).host.toLowerCase(); } catch { return false; }
}

/** Browser Origin that names this front door becomes the upstream origin, so the studio's same-host check passes. */
function rewriteOriginHeader(value, incomingOrigin, upstreamOriginValue) {
  if (!value || !sameHost(value, incomingOrigin)) return value;
  try { return new URL(upstreamOriginValue).origin; } catch { return value; }
}

/** Same host swap as Origin, keeping the path, query, and hash. */
function rewriteReferer(value, incomingOrigin, upstreamOriginValue) {
  if (!value || !sameHost(value, incomingOrigin)) return value;
  try {
    const url = new URL(value);
    const upstream = new URL(upstreamOriginValue);
    url.protocol = upstream.protocol;
    url.host = upstream.host;
    return url.toString();
  } catch {
    return value;
  }
}

/**
 * Outbound request: same method, path, and query. Host is the upstream (also set on the
 * header; Workers may ignore a manual Host and use the URL instead). Origin and Referer
 * are rewritten when they point at this front door. X-Forwarded-Host / Proto tell the
 * studio which public origin the browser used.
 */
function buildUpstreamRequest(request, upstreamOriginValue) {
  const incoming = new URL(request.url);
  const upstream = new URL(upstreamOriginValue);
  const target = new URL(`${incoming.pathname}${incoming.search}`, upstream);
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  headers.set('host', upstream.host);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) {
    const prev = request.headers.get('x-forwarded-for');
    headers.set('x-forwarded-for', prev ? `${prev}, ${ip}` : ip);
  }
  const origin = headers.get('origin');
  if (origin) headers.set('origin', rewriteOriginHeader(origin, incoming.origin, upstream.origin));
  const referer = headers.get('referer');
  if (referer) headers.set('referer', rewriteReferer(referer, incoming.origin, upstream.origin));
  return { url: target.toString(), headers };
}

function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function rewriteResponseHeaders(headers, upstreamOriginValue, publicOrigin) {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    if (HOP_BY_HOP.includes(key.toLowerCase())) return;
    out.append(key, rewriteUpstreamUrls(value, upstreamOriginValue, publicOrigin));
  });
  for (const cookie of readSetCookies(headers)) out.append('set-cookie', rewriteSetCookie(cookie));
  return out;
}

async function rewriteProxyResponse(response, upstreamOriginValue, publicOrigin) {
  const headers = rewriteResponseHeaders(response.headers, upstreamOriginValue, publicOrigin);
  const status = response.status;
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status, statusText: response.statusText, headers });
  }
  if (!textualContentType(response.headers.get('content-type') || '')) {
    return new Response(response.body, { status, statusText: response.statusText, headers });
  }
  const text = await response.text();
  const rewritten = rewriteUpstreamUrls(text, upstreamOriginValue, publicOrigin);
  if (rewritten !== text) headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(rewritten, { status, statusText: response.statusText, headers });
}

async function upstreamHealthy(upstreamOriginValue, timeoutMs = HEALTH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(new URL('/healthz', upstreamOriginValue), {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (res.status !== 200) return false;
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) return false;
    const data = await res.json().catch(() => null);
    return data?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function fetchInit(request, headers) {
  const method = request.method.toUpperCase();
  // Workers rejects a caller-supplied Host and uses the request URL host, which is the upstream.
  headers.delete('host');
  const init = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  return init;
}

async function proxyHttp(request, upstreamOriginValue) {
  const built = buildUpstreamRequest(request, upstreamOriginValue);
  const response = await fetch(built.url, fetchInit(request, built.headers));
  return rewriteProxyResponse(response, upstreamOriginValue, new URL(request.url).origin);
}

function sendableClose(code) {
  return code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code);
}

function bridgeSockets(browserSide, upstreamSide) {
  const pump = (from, to) => {
    from.addEventListener('message', (event) => {
      try { to.send(event.data); } catch { /* the other side is already closing */ }
    });
    from.addEventListener('close', (event) => {
      try {
        if (sendableClose(event.code)) to.close(event.code, event.reason || '');
        else to.close();
      } catch { /* already closed */ }
    });
    from.addEventListener('error', () => {
      try { to.close(1011, 'connection failed'); } catch { /* already closed */ }
    });
  };
  pump(browserSide, upstreamSide);
  pump(upstreamSide, browserSide);
}

/**
 * Workers WebSocket fetch-upgrade: open a new socket to the studio with
 * `Upgrade: websocket`, then bridge it to the browser's socket.
 */
async function proxyWebSocket(request, upstreamOriginValue) {
  const built = buildUpstreamRequest(request, upstreamOriginValue);
  built.headers.delete('host');
  built.headers.set('upgrade', 'websocket');
  // The runtime fills Sec-WebSocket-Key for this new client handshake.
  built.headers.delete('sec-websocket-key');
  built.headers.delete('sec-websocket-version');
  built.headers.delete('sec-websocket-extensions');
  const protocol = request.headers.get('sec-websocket-protocol');
  if (protocol) built.headers.set('sec-websocket-protocol', protocol);

  let upstreamResp;
  try {
    upstreamResp = await fetch(built.url, { headers: built.headers });
  } catch {
    return new Response('The studio could not be reached.', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const upstreamWs = upstreamResp.webSocket;
  if (!upstreamWs) return rewriteProxyResponse(upstreamResp, upstreamOriginValue, new URL(request.url).origin);

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  try {
    upstreamWs.accept({ allowHalfOpen: true });
    server.accept({ allowHalfOpen: true });
  } catch {
    upstreamWs.accept();
    server.accept();
  }
  bridgeSockets(server, upstreamWs);
  return new Response(null, { status: 101, webSocket: client });
}

async function serveDoor(request, env) {
  if (!env || !env.ASSETS) return new Response('Front door assets are unavailable.', { status: 500 });
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'public, max-age=3600');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function loadingPage(request, env) {
  const url = new URL(request.url);
  url.pathname = '/index.html';
  url.search = '';
  const asset = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
  if (asset.status !== 200) {
    return new Response('Batlas is waking up. Refresh in a moment.', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const headers = new Headers(asset.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('set-cookie');
  return new Response(asset.body, { status: 200, headers });
}

const door = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__door' || url.pathname.startsWith(DOOR_PREFIX)) return serveDoor(request, env);

    const upstream = upstreamOrigin(env);
    if (isWebSocketUpgrade(request)) return proxyWebSocket(request, upstream);

    // /healthz is polled by the loading page (and by us). Never replace it with HTML.
    if (url.pathname !== '/healthz' && isTopLevelHtmlNavigation(request)) {
      const healthy = await upstreamHealthy(upstream);
      if (!healthy) return loadingPage(request, env);
    }
    return proxyHttp(request, upstream);
  },
};

// Helpers are properties, not extra exports: Pages treats every named export as a handler.
Object.assign(door, {
  PRODUCTION_UPSTREAM,
  rewriteSetCookie,
  rewriteUpstreamUrls,
  rewriteOriginHeader,
  rewriteReferer,
  buildUpstreamRequest,
  rewriteProxyResponse,
  isTopLevelHtmlNavigation,
  isWebSocketUpgrade,
});

export default door;
