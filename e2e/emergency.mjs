// Sky Crew emergencies e2e: an Admin starts/stops every scenario from the in-game panel (real clicks), the effects
// reach every client, a Trusted player is refused by the server (forged message too), and nothing stays stuck after
// "Stop". Developer hosts.
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const credTxt = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
const devPw = credTxt.match(/password=(.*)/)[1].trim(), devUser = credTxt.match(/username=(.*)/)[1].trim();
const PW = 'Sky-crew-test-pass-1', errs = [];
const browser = await chromium.launch();
const mk = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  await ctx.addInitScript(() => { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply|403/.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`));
  return { p, label };
};
const api = (p, method, url, body) => p.evaluate(async ({ method, url, body }) => {
  const csrf = (await (await fetch('/api/csrf')).json()).csrfToken;
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j };
}, { method, url, body });
const login = async (c, u, pw, reg) => { await c.p.goto(`${B}/login`); const r = await api(c.p, 'POST', reg ? '/api/auth/register' : '/api/auth/login', reg ? { username: u, pin: pw } : { login: u, pin: pw }); if (r.status >= 300) throw new Error(`login ${u} ${r.status}`); };
const boot = async (c) => { await c.p.goto(`${B}/play/sky-crew?fps=2`); await c.p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 }); await c.p.waitForSelector('#bJoin:not([disabled])'); };
const E = (c) => c.p.evaluate(() => window.skyCrew.debug.emerg());
const until = async (cs, pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await Promise.all(cs.map(E)); if (v.every(pred)) return true; await sleep(250); } return false; };

const n = Date.now() % 100000;
const D = await mk('dev'), Ad = await mk('admin'), T = await mk('trusted');
await login(D, devUser, devPw); await login(Ad, `e2e_eadm${n}`, PW, true); await login(T, `e2e_etru${n}`, PW, true);
for (const [c, role] of [[Ad, 'ADMIN'], [T, 'TRUSTED']]) {
  const u = (await api(D.p, 'GET', `/api/admin/users?q=e2e_e${role === 'ADMIN' ? 'adm' : 'tru'}${n}`)).j.users[0];
  check((await api(D.p, 'PUT', `/api/admin/users/${u.id}/role`, { role })).status === 200, `setup: ${c.label} is ${role}`);
}
await boot(D); await D.p.click('#bCreate'); await D.p.waitForFunction(() => window.skyCrew.state().room?.code);
const code = await D.p.evaluate(() => window.skyCrew.state().room.code);
for (const c of [Ad, T]) { await boot(c); await c.p.fill('#joinCode', code); await c.p.click('#bJoin'); await c.p.waitForFunction(() => window.skyCrew.state().room); }
for (const c of [D, Ad, T]) await c.p.click('#bBoard');
for (const c of [D, Ad, T]) await c.p.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 2, null, { timeout: 30000 });
const all = [D, Ad, T];

// panel: Admin sees the Emergencies tab with Start + Stop, Trusted does not
await Ad.p.evaluate(() => window.skyCrew.openPanel(true));
const adTabs = await Ad.p.evaluate(() => window.skyCrew.panelTabs());
await T.p.evaluate(() => window.skyCrew.openPanel(true));
const trTabs = await T.p.evaluate(() => window.skyCrew.panelTabs()).catch(() => []);
await T.p.evaluate(() => window.skyCrew.openPanel(false));
check(adTabs.includes('emerg') && !trTabs.includes('emerg'), `Emergencies tab: Admin yes, Trusted no (${trTabs.join(',') || 'no panel'})`);
await Ad.p.click('#admTabs [data-tab="emerg"]');
const clickStart = (id) => Ad.p.click(`[data-scenario="${id}"]`);
const clickStop = (label) => Ad.p.locator('#admin button', { hasText: `Stop ${label}` }).first().click();

await clickStart('engine_failure');
check(await until(all, (e) => e.engineFail), 'engine failure: on for all 3 clients');
await clickStop('engine failure');
check(await until(all, (e) => !e.engineFail), 'engine failure: Stop clears it everywhere');

await clickStart('cabin_pressure');
check(await until(all, (e) => e.masks), 'cabin pressure: oxygen masks drop for all 3 clients');
await clickStop('cabin pressure');
check(await until(all, (e) => !e.masks), 'cabin pressure: Stop raises the masks everywhere');

await clickStart('emergency_landing');
check(await until(all, (e) => e.landing != null && e.landing <= 240), 'emergency landing: timer running on all clients');
await Ad.p.evaluate(() => window.skyCrew.openPanel(false));
check(await until([T], (e) => e.hud, 5000), 'emergency landing: countdown shown in the Trusted player\'s HUD');
await Ad.p.evaluate(() => window.skyCrew.openPanel(true)); await Ad.p.click('#admTabs [data-tab="emerg"]');
await clickStop('emergency landing');
check(await until(all, (e) => e.landing == null && !e.hud), 'emergency landing: Stop removes the timer and HUD line everywhere');

await clickStart('turbulence');
check(await D.p.waitForFunction(() => window.skyCrew.debug.events().includes('turbulence'), null, { timeout: 6000 }).then(() => true, () => false), 'turbulence: event running on the host');
await clickStop('severe turbulence');
check(await D.p.waitForFunction(() => !window.skyCrew.debug.events().includes('turbulence'), null, { timeout: 6000 }).then(() => true, () => false), 'turbulence: Stop ends it');

// Trusted forging the message: server refuses, nothing happens
const r = await T.p.evaluate(() => window.skyCrew.net.admin('emergency', { scenario: 'engine_failure', action: 'start' }).then(() => 'ok', (e) => e.message));
await sleep(1200);
check(r !== 'ok' && (await Promise.all(all.map(E))).every((e) => !e.engineFail), `Trusted forged emergency refused by the server ("${r}")`);
check(errs.length === 0, `no console errors${errs.length ? ` ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED'); process.exit(fail.length ? 1 : 0);
