// Sky Crew polish / regression e2e: 3-client co-op (airport crew status, host skip moves guests out of the terminal),
// a dropped socket mid-game (keeps playing solo, airport progress kept), rejoining the room, maintenance mode
// removing players from live rooms, and no console errors anywhere.
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/polish', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const report = [], fail = [];
const check = (c, m) => { (c ? report : fail).push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Refused to apply a stylesheet|Refused to apply inline style|apply inline style|503|Service Unavailable/i;
const credTxt = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
const devPw = credTxt.match(/password=(.*)/)[1].trim(), devUser = credTxt.match(/username=(.*)/)[1].trim();
const PW = 'Sky-crew-test-pass-1';
const errs = [];
const browser = await chromium.launch();
const mk = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('skycrew.quality', 'low'); localStorage.removeItem('skycrew.skipAirport'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${label}] pageerror ${e.message}`));
  p.on('dialog', (d) => d.accept());
  return { ctx, p, label };
};
const api = (p, method, url, body) => p.evaluate(async ({ method, url, body }) => {
  const csrf = (await (await fetch('/api/csrf')).json()).csrfToken;
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, j };
}, { method, url, body });
async function login(c, username, password, register = false) {
  await c.p.goto(`${B}/login`);
  const r = await api(c.p, 'POST', register ? '/api/auth/register' : '/api/auth/login', register ? { username, pin: password } : { login: username, pin: password });
  if (r.status >= 300) throw new Error(`${register ? 'register' : 'login'} ${username} -> ${r.status}`);
}
const tap = async (c, sel) => { await c.p.waitForSelector(sel, { state: 'visible', timeout: 15000 }); await c.p.$eval(sel, (b) => { if (b.disabled) throw new Error(`${b.id} disabled`); b.click(); }); };
const SC = (c, fn, arg) => c.p.evaluate(fn, arg);
const st = (c) => SC(c, () => window.skyCrew.state());
const term = (c) => SC(c, () => window.skyCrew.term());
const waitFor = async (c, fn, ms = 15000, arg) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await SC(c, fn, arg).catch(() => false)) return true; await sleep(300); } return false; };
const boot = async (c) => { await c.p.goto(`${B}/play/sky-crew?fps=2`, { waitUntil: 'load' }); await c.p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 }); await c.p.waitForSelector('#bJoin:not([disabled])'); };
const shot = (c, n) => c.p.screenshot({ path: `${OUT}/${n}.png` });

const tag = Date.now().toString(36).slice(-5);
const P = [await mk('host'), await mk('g1'), await mk('g2')];
for (const [i, c] of P.entries()) { await login(c, `e2e_p${i}${tag}`, PW, true); await boot(c); }
await tap(P[0], '#bCreate'); await waitFor(P[0], () => !!window.skyCrew.state().room?.code);
const code = (await st(P[0])).room.code;
for (const c of P.slice(1)) { await c.p.fill('#joinCode', code); await tap(c, '#bJoin'); await waitFor(c, () => !!window.skyCrew.state().room); }
for (const c of P) await tap(c, '#bBoard');
const allIn = await Promise.all(P.map((c) => waitFor(c, () => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 2, 30000)));
check(allIn.every(Boolean), '3 clients in one co-op room see each other');
let T = await Promise.all(P.map(term));
check(T.every((t) => t.airport && t.active && t.crew.list.length === 3 && !t.crew.ready), `all three start in the terminal, crew status 0/3 (${T.map((t) => t.crew.list.length).join(',')})`);
check((await Promise.all(P.map(st))).every((s) => s.me.z > 50), 'everyone spawns in the terminal hall');
await shot(P[1], 'coop3-terminal');

// --- a dropped socket mid-game: g2 keeps playing solo, nothing stuck
await SC(P[2], () => { window.skyCrew.term(); });
await SC(P[2], () => window.skyCrew.net.ws.close());
const solo = await waitFor(P[2], () => !window.skyCrew.state().room && window.skyCrew.state().host && window.skyCrew.state().remotes.length === 0, 10000);
check(solo, 'g2: dropped connection -> continues solo as its own host, remotes cleared');
const toast = await P[2].p.$$eval('#toasts > *', (els) => els.map((e) => e.textContent).join(' | '));
check(/Disconnected from the co-op room/.test(toast), `g2: told it was disconnected ("${toast.slice(0, 80)}")`);
const s2a = await st(P[2]); await sleep(1500); const s2b = await st(P[2]);
check(s2b.playing && !s2b.paused && s2b.phase === 'boarding', 'g2: still playing after the drop (no stuck screen)');
const T2 = await term(P[2]);
check(T2.active && T2.crew.list.length === 1, `g2: solo airport flow carries on (crew ${T2.crew.list.length}, step ${T2.step})`);
void s2a;
check(await waitFor(P[0], () => window.skyCrew.state().remotes.length === 1 && window.skyCrew.term().crew.list.length === 2, 15000), 'host: the dropped player leaves the crew list (2 left), departure not blocked by them');
// g2 rejoins through the menu
await tap(P[2], '#btnPause'); await tap(P[2], '#bQuit');
await P[2].p.waitForSelector('#bJoin:not([disabled])', { timeout: 15000 });
await P[2].p.fill('#joinCode', code); await tap(P[2], '#bJoin');
const rej = await waitFor(P[2], () => !!window.skyCrew.state().room, 15000);
if (rej) await tap(P[2], '#bBoard');
check(rej && await waitFor(P[2], () => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 2, 30000), 'g2: rejoined the same room and sees both crewmates again');
check(await waitFor(P[0], () => window.skyCrew.term().crew.list.length === 3, 10000), 'host: crew back to 3 after the rejoin');
check((await term(P[2])).step === 'none' && (await st(P[2])).me.z > 50, 'g2: a rejoiner starts the airport fresh (server reset)');

// --- host turns the airport off mid-boarding: guests in the terminal are moved to the apron
await tap(P[0], '#btnPause'); await tap(P[0], '#bSettingsP');
await P[0].p.$eval('#setSkipAirport', (e) => e.click());
await tap(P[0], '#bSetClose'); await P[0].p.$eval('#bResume', (b) => b.click()).catch(() => {});
const moved = await Promise.all(P.slice(1).map((c) => waitFor(c, () => window.skyCrew.state().room?.airport === false && window.skyCrew.state().me.z < 30 && window.skyCrew.term().crew.ready, 15000)));
check(moved.every(Boolean), 'host skip: both guests see airport off, are moved to the apron, crew ready');
await shot(P[1], 'coop3-after-skip');

// --- maintenance removes players from live rooms; Developer turns it on and off
const D = await mk('dev'); await login(D, devUser, devPw);
let r = await api(D.p, 'PUT', '/api/dev/maintenance', { enabled: true, message: 'Polish test maintenance' });
check(r.status === 200, `Developer turns maintenance on (${r.status})`);
try {
  const out = await Promise.all(P.map((c) => waitFor(c, () => !document.getElementById('maint').classList.contains('hidden') && !window.skyCrew.state().playing, 25000)));
  check(out.every(Boolean), 'maintenance: all three players are taken out of the room and see the maintenance screen');
  check(/Polish test maintenance|maintenance/i.test(await P[1].p.textContent('#maintMsg')), 'maintenance: the message is shown');
  await shot(P[1], 'maintenance-screen');
} finally {
  r = await api(D.p, 'PUT', '/api/dev/maintenance', { enabled: false });
  check(r.status === 200, `Developer turns maintenance off (${r.status})`);
}
// after maintenance, a player can play online again
await boot(P[1]);
await tap(P[1], '#bCreate');
check(await waitFor(P[1], () => !!window.skyCrew.state().room?.code, 15000), 'after maintenance: a player can create a room again');

console.log(`\n${report.length} passed, ${fail.length} failed`);
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
