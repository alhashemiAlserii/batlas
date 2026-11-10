import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';
import { setup } from './helpers.js';
import { WEB_ROOT } from '../src/config.js';

let env: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { delete process.env.MAINTENANCE_MODE; await env.close(); });

const PUB = path.join(WEB_ROOT, 'public');

describe('PWA: manifest and icons', () => {
  it('serves a valid manifest (standalone, start_url /, site theme colour) with real icons', async () => {
    const r = await request(env.app).get('/manifest.webmanifest');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/manifest\+json/);
    const m = JSON.parse(r.text);
    expect(m).toMatchObject({ name: 'Batlas', short_name: 'Batlas', start_url: '/', scope: '/', display: 'standalone' });
    const siteTheme = /name="theme-color" content="([^"]+)"/.exec(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'))![1];
    expect(m.theme_color).toBe(siteTheme);
    expect(m.background_color).toBe(siteTheme);
    const want = [['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']];
    for (const [sizes, purpose] of want) {
      const icon = m.icons.find((i: any) => i.sizes === sizes && i.purpose === purpose);
      expect(icon, `${sizes} ${purpose}`).toBeTruthy();
      const res = await request(env.app).get(icon.src).buffer(true);
      expect(res.status).toBe(200);
      const meta = await sharp(res.body).metadata();
      expect(`${meta.width}x${meta.height}`).toBe(sizes);
      expect(meta.format).toBe('png');
    }
    for (const p of ['/img/icons/apple-touch-icon-180.png', '/apple-touch-icon.png']) {
      const res = await request(env.app).get(p).buffer(true);
      expect(res.status).toBe(200);
      const meta = await sharp(res.body).metadata();
      expect([meta.width, meta.height, meta.hasAlpha]).toEqual([180, 180, false]); // iOS wants opaque
    }
  });

  it('every site page links the manifest, has the iOS home-screen tags and registers the worker', () => {
    const pages = [...fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).map((f) => path.join(PUB, f)),
      ...fs.readdirSync(path.join(WEB_ROOT, 'private')).filter((f) => f.endsWith('.html')).map((f) => path.join(WEB_ROOT, 'private', f))];
    expect(pages.length).toBeGreaterThan(15);
    for (const p of pages) {
      const s = fs.readFileSync(p, 'utf8');
      const name = path.basename(p);
      expect(s, name).toContain('<link rel="manifest" href="/manifest.webmanifest">');
      expect(s, name).toContain('<link rel="apple-touch-icon" href="/img/icons/apple-touch-icon-180.png">');
      if (name === 'offline.html') continue;
      for (const tag of ['apple-mobile-web-app-capable" content="yes"', 'apple-mobile-web-app-title" content="Batlas"', 'apple-mobile-web-app-status-bar-style"', 'mobile-web-app-capable" content="yes"']) expect(s, `${name} ${tag}`).toContain(tag);
      expect(/src="\/js\/(common|pwa)\.js"/.test(s), name).toBe(true);
    }
    expect(fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8')).toMatch(/^import '\.\/pwa\.js';$/m);
  });
});

describe('PWA: service worker', () => {
  it('is served as JS from the root scope with no-cache; offline page exists', async () => {
    const r = await request(env.app).get('/sw.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/javascript/);
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['service-worker-allowed']).toBe('/');
    const off = await request(env.app).get('/offline.html');
    expect(off.status).toBe(200);
    expect(off.text).toMatch(/offline/i);
  });

  it('stays reachable in maintenance mode (so the worker, manifest and offline page keep working)', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    try {
      expect((await request(env.app).get('/')).status).toBe(503);
      for (const p of ['/sw.js', '/manifest.webmanifest', '/offline.html', '/apple-touch-icon.png', '/img/icons/icon-192.png']) {
        expect((await request(env.app).get(p)).status, p).toBe(200);
      }
    } finally { delete process.env.MAINTENANCE_MODE; }
  });

  /** Runs sw.js in a sandbox and reports how it would handle each request. */
  function loadWorker() {
    const listeners: Record<string, (e: any) => void> = {};
    const store = new Map<string, any>();
    const cache = { addAll: async (l: string[]) => l.forEach((u) => store.set(u, { status: 200 })), put: async (k: any, v: any) => { store.set(typeof k === 'string' ? k : new URL(k.url).pathname, v); }, match: async (k: any) => store.get(typeof k === 'string' ? k : new URL(k.url).pathname) };
    const self: any = {
      location: { origin: 'https://batlas.test' },
      addEventListener: (t: string, fn: any) => { listeners[t] = fn; },
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    };
    const sandbox: any = { self, caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async (k: any) => cache.match(k) }, URL, Request: class { url: string; constructor(u: string) { this.url = new URL(u, 'https://batlas.test').toString(); } }, fetch: async () => { throw new TypeError('offline'); }, console };
    vm.runInNewContext(fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8'), sandbox);
    const handle = (url: string, init: { method?: string; mode?: string; range?: boolean } = {}) => {
      let responded: Promise<any> | null = null;
      const headers = new Map(init.range ? [['range', 'bytes=0-']] : []);
      listeners.fetch({ request: { url: new URL(url, 'https://batlas.test').toString(), method: init.method ?? 'GET', mode: init.mode ?? 'no-cors', headers: { has: (h: string) => headers.has(h) } }, respondWith: (p: Promise<any>) => { responded = p; }, waitUntil: () => {} });
      return responded;
    };
    return { listeners, handle, store };
  }

  it('never handles /api, /media (incl. Range), /uploads, Sky Crew, WebSocket paths, gated pages, non-GET or cross-origin', () => {
    const { handle } = loadWorker();
    const untouched = ['/api/me', '/api/csrf', '/api/internal/backup', '/media/1.mp4', '/media/7', '/uploads/a.png', '/play/sky-crew', '/play/sky-crew/js/main.js', '/play/vendor/three.module.js', '/ws/sky-crew', '/studio-console', '/studio-console/app.js', '/admin', '/admin/app.js', '/healthz', '/sw.js', 'https://www.youtube-nocookie.com/embed/x', '/random-thing'];
    for (const u of untouched) expect(handle(u), u).toBeNull();
    for (const u of ['/play/sky-crew', '/studio-console', '/api/me']) expect(handle(u, { mode: 'navigate' }), `navigate ${u}`).toBeNull();
    expect(handle('/media/1.mp4', { range: true })).toBeNull();
    expect(handle('/css/site.css', { range: true })).toBeNull();
    expect(handle('/api/auth/login', { method: 'POST' })).toBeNull();
    expect(handle('/', { method: 'POST', mode: 'navigate' })).toBeNull();
  });

  it('handles the site shell and falls back to /offline.html for pages when the network is down', async () => {
    const { handle, listeners, store } = loadWorker();
    let installed: Promise<any> | null = null;
    listeners.install({ waitUntil: (p: Promise<any>) => { installed = p; } });
    await installed;
    expect([...store.keys()]).toEqual(expect.arrayContaining(['/offline.html', '/css/site.css', '/manifest.webmanifest', '/img/icons/icon-192.png']));
    expect([...store.keys()].some((k) => /^\/(api|media|play)/.test(k))).toBe(false);
    for (const u of ['/', '/games', '/games/sky-crew', '/news', '/news/hello', '/login?next=/x', '/u/abood', '/css/site.css', '/js/common.js', '/img/icons/icon-512.png', '/manifest.webmanifest']) {
      const p = handle(u);
      expect(p, u).not.toBeNull();
      (p as unknown as Promise<unknown>).catch(() => {}); // offline + not cached: rejects, like a real network error
    }
    const page = await handle('/games', { mode: 'navigate' });
    expect(page).toBe(store.get('/offline.html'));
    expect(await handle('/css/site.css')).toBe(store.get('/css/site.css'));
  });
});
