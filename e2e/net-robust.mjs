// Sky Crew connection robustness e2e: a failed or silent handshake never leaves a half-open socket, a double tap on
// Create opens one socket and one room, a drop while waiting in the lobby goes back to the menu, and a room closed
// under the Developer mid-game continues solo (host, nothing frozen). No console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Refused to apply|503|Service Unavailable|WebSocket connection to .* failed|ERR_CONNECTION/i;
const credTxt = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
const devPw = credTxt.match(/password=(.*)/)[1].trim(), devUser = credTxt.match(/username=(.*)/)[1].trim();
const errs = [];
const browser = await chromium.launch();
const mk = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${label}] pageerror ${e.message}`));
  p.on('dialog', (d) => d.accept());
  return { ctx, p };
};
const api = (p, method, url, body) => p.evaluate(async ({ method, url, body }) => {
  const csrf = (await (await fetch('/api/csrf')).json()).csrfToken;
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
  return r.status;
}, { method, url, body });
const waitFor = async (p, fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(200); } return false; };
const boot = async (p) => { await p.goto(`${B}/play/sky-crew?fps=2`, { waitUntil: 'load' }); await p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 }); await p.waitForSelector('#bCreate:not([disabled])'); };
const menuErr = (p) => p.evaluate(() => !document.querySelector('#menuErr').classList.contains('hidden') && document.querySelector('#menuErr').textContent);

const tag = Date.now().toString(36).slice(-5);
const A = await mk('player');
await A.p.goto(`${B}/login`);
check(await api(A.p, 'POST', '/api/auth/register', { username: `e2e_net${tag}`, pin: '123456' }) < 300, 'register a test player');
await boot(A.p);

// 1) the game server closes the socket before 'welcome': fast error, socket forgotten, buttons usable again
await A.p.routeWebSocket(/\/ws\/sky-crew/, (ws) => { ws.onMessage(() => ws.close({ code: 1011, reason: 'test: refused' })); });
let t0 = Date.now();
await A.p.click('#bCreate');
check(await waitFor(A.p, () => !document.querySelector('#menuErr').classList.contains('hidden'), 5000) && Date.now() - t0 < 5000, `early close: error shown quickly (${Date.now() - t0} ms), not after the 8 s timeout`);
check(await A.p.evaluate(() => window.skyCrew.net.ws === null && !window.skyCrew.net.connected), 'early close: no half-open socket kept');
check(await A.p.evaluate(() => !document.querySelector('#bCreate').disabled && !document.querySelector('#bJoin').disabled), 'early close: Create/Join enabled again');
check(await A.p.evaluate(() => document.querySelector('#lobby').classList.contains('hidden')), 'early close: no lobby opened');

// 2) a silent server (never answers): times out, then the late socket is closed and forgotten
const silent = [];
await A.p.unrouteAll({ behavior: 'wait' });
await A.p.routeWebSocket(/\/ws\/sky-crew/, (ws) => { silent.push(ws); });
t0 = Date.now();
await A.p.click('#bCreate');
check(await waitFor(A.p, () => /did not answer/i.test(document.querySelector('#menuErr').textContent), 12000), `silent server: "did not answer" after ${Math.round((Date.now() - t0) / 1000)} s`);
check(await A.p.evaluate(() => window.skyCrew.net.ws === null), 'silent server: socket dropped after the timeout');
// 3) double tap (fresh tab, same signed-in player, no WebSocket routes) on Create: one socket, one 'create', one room
const A2 = await A.ctx.newPage();
A2.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[player2] ${m.text()}`); });
A2.on('pageerror', (e) => errs.push(`[player2] pageerror ${e.message}`));
await A.p.close(); A.p = A2;
await boot(A.p);
let sockets = 0, creates = 0;
A.p.on('websocket', (ws) => { if (/ws\/sky-crew/.test(ws.url())) { sockets++; ws.on('framesent', (f) => { if (/"t":"create"/.test(String(f.payload))) creates++; }); } });
await A.p.evaluate(() => { const b = document.querySelector('#bCreate'); b.click(); b.click(); b.click(); });
check(await waitFor(A.p, () => !document.querySelector('#lobby').classList.contains('hidden') && !!window.skyCrew.state().room?.code, 15000), 'double tap: lobby opens with a room code');
await sleep(800);
check(sockets === 1 && creates === 1, `double tap: exactly one socket and one create (${sockets} sockets, ${creates} creates)`);

// 4) the socket drops while waiting in the lobby: back to the menu with a message, no dead lobby
await A.p.evaluate(() => window.skyCrew.net.ws.close());
check(await waitFor(A.p, () => document.querySelector('#lobby').classList.contains('hidden') && !document.querySelector('#menu').classList.contains('hidden'), 5000), 'lobby drop: back to the main menu');
check(/lost the connection/i.test(await menuErr(A.p) || ''), 'lobby drop: tells the player what happened');
check(!(await A.p.evaluate(() => window.skyCrew.state().room)), 'lobby drop: no stale room');
// and it can go online again straight away
await A.p.click('#bCreate');
check(await waitFor(A.p, () => !!window.skyCrew.state().room?.code, 15000), 'lobby drop: Create works again afterwards');
await A.p.click('#bLobLeave');

// 5) the Developer closes the room they are playing in: continues solo as host, nothing frozen
const D = await mk('dev');
await D.p.goto(`${B}/login`);
check(await api(D.p, 'POST', '/api/auth/login', { login: devUser, pin: devPw }) < 300, 'Developer signs in');
await boot(D.p);
await D.p.click('#bCreate');
await waitFor(D.p, () => !!window.skyCrew.state().room?.code);
await D.p.click('#bBoard');
check(await waitFor(D.p, () => window.skyCrew.state().playing), 'Developer is playing in a co-op room');
const code = await D.p.evaluate(() => window.skyCrew.state().room.code);
await D.p.evaluate((code) => window.skyCrew.net.admin('close_room', { code }).catch(() => null), code);
check(await waitFor(D.p, () => { const s = window.skyCrew.state(); return !s.room && s.host && s.playing && !s.paused; }, 8000), 'room closed: Developer keeps playing solo as host');
const z0 = await D.p.evaluate(() => window.skyCrew.state().me.z);
await D.p.keyboard.down('w'); await sleep(900); await D.p.keyboard.up('w');
check(Math.abs((await D.p.evaluate(() => window.skyCrew.state().me.z)) - z0) > 0.2, 'room closed: can still walk (not frozen)');

check(errs.length === 0, `no console errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED');
process.exit(fail.length ? 1 : 0);
