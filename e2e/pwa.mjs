// PWA end-to-end check (Playwright, Chromium + WebKit).
//   BASE=http://127.0.0.1:3400 node pwa.mjs
// Verifies: manifest is linked and valid, the service worker registers at scope "/" and controls the
// page, Chromium reports the site installable, /api and /play/sky-crew responses never come from the
// worker or its cache, the cache holds only shell files, and offline navigation shows the offline page.
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';

const B = process.env.BASE || 'http://127.0.0.1:3400';
const OUT = new URL('../docs/screenshots/pwa/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const problems = []; const results = []; const notes = [];
const check = (cond, m) => { (cond ? results : problems).push(m); console.log(cond ? '  ✓' : '  ✗', m); };

async function run(name, type, device) {
  console.log(`\n${name}`);
  const browser = await type.launch();
  const ctx = await browser.newContext({ ...device, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  try {
    await page.goto(`${B}/`, { waitUntil: 'load' });
    const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
    check(manifestHref === '/manifest.webmanifest', `${name}: manifest linked`);
    const m = await (await page.request.get(`${B}${manifestHref}`)).json();
    check(m.name === 'Batlas' && m.display === 'standalone' && m.start_url === '/', `${name}: manifest name/display/start_url`);
    check(await page.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content') === 'yes', `${name}: apple-mobile-web-app-capable`);

    const reg = await page.evaluate(async () => {
      const r = await Promise.race([navigator.serviceWorker.ready, new Promise((_, j) => setTimeout(() => j(new Error('sw timeout')), 15000))]);
      return { scope: r.scope, state: r.active?.state, script: r.active?.scriptURL };
    });
    check(reg.scope === `${B}/` && /\/sw\.js$/.test(reg.script), `${name}: service worker registered (scope ${new URL(reg.scope).pathname}, ${reg.state})`);

    await page.reload({ waitUntil: 'load' });
    check(await page.evaluate(() => !!navigator.serviceWorker.controller), `${name}: page is controlled by the worker after reload`);

    if (type === chromium) {
      const cdp = await ctx.newCDPSession(page);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      check(installabilityErrors.length === 0, `${name}: Chromium installability errors: ${installabilityErrors.map((e) => e.errorId).join(', ') || 'none'}`);
    }

    // API requests made by the page: never answered by the worker. Do it twice so a cache would be warm.
    for (let i = 0; i < 2; i++) {
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url() === `${B}/api/me`),
        page.evaluate(() => fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.status)),
      ]);
      check(!resp.fromServiceWorker(), `${name}: /api/me #${i + 1} not served by the service worker (status ${resp.status()}, cache-control ${resp.headers()['cache-control']})`);
    }
    // Positive control: a shell file fetched by the page IS answered by the worker (proves the /api check above means something).
    const [cssResp] = await Promise.all([
      page.waitForResponse((r) => r.url() === `${B}/css/site.css`),
      page.evaluate(() => fetch('/css/site.css').then((r) => r.status)),
    ]);
    if (cssResp.fromServiceWorker()) check(true, `${name}: positive control: /css/site.css IS served by the worker`);
    else notes.push(`${name}: Playwright reports fromServiceWorker()=false even for the worker-handled CSS, so in this engine the /api check is backed by the cache-content and offline checks instead`);

    const keys = await page.evaluate(async () => {
      const out = [];
      for (const n of await caches.keys()) for (const req of await (await caches.open(n)).keys()) out.push(n + ' ' + new URL(req.url).pathname);
      return out;
    });
    const badKeys = keys.filter((k) => /\s\/(api|media|uploads|play|ws|studio-console|admin)(\/|$)/.test(k));
    check(keys.length > 0 && badKeys.length === 0, `${name}: cache holds ${keys.length} shell entries, none for /api /media /play /ws /admin (${badKeys.join(', ') || 'ok'})`);

    // Sky Crew page and its assets go straight to the network.
    const sky = await page.goto(`${B}/play/sky-crew`, { waitUntil: 'domcontentloaded' });
    check(sky && !sky.fromServiceWorker(), `${name}: /play/sky-crew not served by the worker`);
    const skyKeys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname)))).flat().filter((p) => p.startsWith('/play')));
    check(skyKeys.length === 0, `${name}: nothing from /play cached after visiting Sky Crew`);

    // Offline: an uncached page falls back to /offline.html; the cached homepage still opens.
    await page.goto(`${B}/`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    await ctx.setOffline(true);
    await page.goto(`${B}/contact`, { waitUntil: 'load' }).catch(() => {});
    const offText = await page.textContent('body').catch(() => '');
    check(/You're offline/.test(offText || ''), `${name}: offline navigation to an uncached page shows the offline page`);
    await page.screenshot({ path: `${OUT}${name.replace(/\W+/g, '-').toLowerCase()}-offline.png` });
    await page.goto(`${B}/`, { waitUntil: 'load' }).catch(() => {});
    check(!/You're offline/.test((await page.textContent('body').catch(() => '')) || '') && /Batlas/i.test(await page.title()), `${name}: cached homepage opens offline`);
    const apiOffline = await page.evaluate(() => fetch('/api/me').then(() => 'answered', () => 'network-error'));
    check(apiOffline === 'network-error', `${name}: /api offline is a network error (never a cached answer)`);
    await ctx.setOffline(false);
  } catch (e) {
    check(false, `${name}: crashed: ${e.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

await run('Chromium desktop', chromium, { viewport: { width: 1280, height: 800 } });
await run('Chromium iPhone', chromium, devices['iPhone 13']);
await run('WebKit iPhone', webkit, devices['iPhone 13']);
await run('WebKit iPad', webkit, devices['iPad (gen 7)']);
await run('WebKit desktop', webkit, { viewport: { width: 1280, height: 800 } });

const summary = `PWA e2e ${new Date().toISOString()}: ${results.length} passed, ${problems.length} failed\n` + [...results.map((r) => 'PASS ' + r), ...problems.map((p) => 'FAIL ' + p), ...notes.map((n) => 'NOTE ' + n)].join('\n') + '\n';
fs.writeFileSync(`${OUT}RESULTS.txt`, summary);
console.log('\n' + summary.split('\n')[0]);
process.exitCode = problems.length ? 1 : 0;
