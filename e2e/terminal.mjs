// Sky Crew airport terminal e2e: passport -> boarding pass -> X-ray + scanner -> gate -> board, solo and co-op,
// no-skipping (closed barriers, forged steps refused by the server), the plane holds until the crew boards, Skip airport.
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/terminal', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const report = [], fail = [];
const ok = (m) => { report.push(m); console.log(`✔ ${m}`); };
const bad = (m) => { fail.push(m); console.log(`✘ ${m}`); };
const check = (cond, m, extra = '') => (cond ? ok(m) : bad(`${m} ${extra}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Refused to apply a stylesheet|Refused to apply inline style|apply inline style/i;
const credTxt = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
const devPw = credTxt.match(/password=(.*)/)[1].trim(), devUser = credTxt.match(/username=(.*)/)[1].trim();
const PW = 'Sky-crew-test-pass-1';
const errs = [];
const browser = await chromium.launch();
const mk = async (label, q = 'low', fps = 1) => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  await ctx.addInitScript((q) => { try { localStorage.setItem('skycrew.quality', q); } catch { /* ignore */ } }, q);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${label}] pageerror ${e.message}`));
  p.on('dialog', (d) => d.accept());
  return { ctx, p, label, fps };
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
// software GL with 4 game pages is very slow, so Playwright's "stable element" check (two animation frames) can stall:
// click through the DOM (real click events on the real buttons) after checking the button is there and visible.
const tap = async (c, sel) => { await c.p.waitForSelector(sel, { state: 'visible', timeout: 10000 }); await c.p.$eval(sel, (b) => { if (b.disabled) throw new Error(`${b.id || b.textContent} is disabled`); b.click(); }); };
const SC = (c, fn, arg) => c.p.evaluate(fn, arg);
const st = (c) => SC(c, () => window.skyCrew.state());
const gd = (c) => SC(c, () => window.skyCrew.gadgets());
const admin = (c, cmd, args) => SC(c, ({ cmd, args }) => window.skyCrew.admin(cmd, args).then((r) => r.t, (e) => `denied: ${e.message}`), { cmd, args });
const shot = async (c, name) => { await c.p.evaluate(() => window.skyCrew?.draw?.()).catch(() => {}); await sleep(400); await c.p.screenshot({ path: `${OUT}/${name}.png` }); };
/** send a raw (possibly forged) message and collect the server's direct answer */
const raw = (c, msg, wait = 'error') => SC(c, ({ msg, wait }) => new Promise((res) => {
  const net = window.skyCrew.net; const h = (e) => { net.removeEventListener(wait, h); res(e.detail); };
  net.addEventListener(wait, h); net.send(msg); setTimeout(() => { net.removeEventListener(wait, h); res(null); }, 4000);
}), { msg, wait });



const boot = async (c, q = '') => {
  await c.p.goto(`${B}/play/sky-crew?fps=${c.fps}${q}`, { waitUntil: 'load' }); await c.p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
};
const term = (c) => SC(c, () => window.skyCrew.term());
const waitT = async (c, fn, ms = 12000) => { const t0 = Date.now(); let t; while (Date.now() - t0 < ms) { t = await term(c).catch(() => null); if (t && fn(t)) return true; await sleep(250); } console.log('   last term:', JSON.stringify(t).slice(0, 300)); return false; };
const S = { checkin: [-4.2, 53.9], belt: [-3.2, 48.3], arch: [1.6, 44], gatedesk: [2.6, 31.2] };
const F = -2.4;
async function at(c, x, z, lookAt) { await SC(c, ({ x, z, F, lookAt }) => { window.skyCrew.teleport(x, F, z); if (lookAt) window.skyCrew.lookAt(...lookAt); }, { x, z, F, lookAt }); await sleep(450); }
async function useDesk(c, x, z, lx, lz, ly = -1.2) { await at(c, x, z, [lx, ly, lz]); const t = await SC(c, () => window.skyCrew.target()); await SC(c, () => window.skyCrew.interact()); return t; }
async function tryDepart(c, ms = 2500) {
  await SC(c, () => { window.skyCrew.takeSeat(); window.skyCrew.key('KeyR', true); });
  await sleep(ms);
  await SC(c, () => window.skyCrew.key('KeyR', false));
  const s = await st(c); return { phase: s.phase, speed: s.flight.speed, throttle: s.flight.throttle };
}
/** the full honest walk: passport -> boarding pass -> belt + scanner -> gate -> board */
async function walkThrough(c, tag) {
  let t0 = await useDesk(c, -4.2, 54.4, -4.2, 52.9);
  check(/passport/i.test(t0?.label || ''), `${tag}: check-in prompt ("${t0?.label}")`);
  check(await waitT(c, (t) => t.step === 'checkin' && /Boarding pass/.test(t.docs)), `${tag}: passport handed over -> boarding pass in hand`);
  await shot(c, `${tag}-checkin`);
  check((await term(c)).solids.includes('term:arch'), `${tag}: scanner arch is closed until the bag is on the belt`);
  t0 = await useDesk(c, -3.2, 48.6, -3.2, 47.4, -1.5);
  check(/X-ray/.test(t0?.label || ''), `${tag}: X-ray belt prompt ("${t0?.label}")`);
  check(await waitT(c, (t) => t.bag && !t.solids.includes('term:arch')), `${tag}: bag on the belt opens the scanner arch`);
  await SC(c, () => window.skyCrew.debug.cam([4.5, 0.2, 48.5], [-1, -1.4, 43.5])); await sleep(900); await shot(c, `${tag}-security-belt`); await SC(c, () => window.skyCrew.debug.cam(null));
  check(await waitT(c, (t) => t.bagDone), `${tag}: bag came out of the X-ray tunnel`);
  await at(c, 1.6, 45.2, [1.6, -1.0, 40]);
  // walk through the arch for real (W)
  await SC(c, () => window.skyCrew.key('KeyW', true));
  await c.p.waitForFunction(() => window.skyCrew.state().me.z < 42.8, null, { polling: 200, timeout: 15000 }).catch(() => {});
  await SC(c, () => window.skyCrew.key('KeyW', false));
  check(await waitT(c, (t) => t.step === 'security', 9000), `${tag}: walked through the scanner (beep) -> security cleared`);
  check((await term(c)).solids.includes('term:gate'), `${tag}: gate door closed until the pass is scanned`);
  t0 = await useDesk(c, 2.6, 31.4, 2.6, 30.0);
  check(/boarding pass/i.test(t0?.label || ''), `${tag}: gate agent prompt ("${t0?.label}")`);
  check(await waitT(c, (t) => t.step === 'gate' && !t.solids.includes('term:gate')), `${tag}: boarding pass scanned -> gate door open`);
  await shot(c, `${tag}-gate`);
  // through the gate door and down the walkway
  await at(c, 0, 27.2, [0, -1.0, 20]);
  await SC(c, () => window.skyCrew.key('KeyW', true));
  await c.p.waitForFunction(() => window.skyCrew.state().me.z < 24.5, null, { polling: 200, timeout: 15000 }).catch(() => {});
  await SC(c, () => window.skyCrew.key('KeyW', false));
  check((await st(c)).me.z < 25, `${tag}: walked out through the gate door onto the walkway (z=${(await st(c)).me.z.toFixed(1)})`);
  await SC(c, () => window.skyCrew.debug.cam([3.5, -0.4, 21], [0, -1.6, 15])); await sleep(900); await shot(c, `${tag}-walkway`); await SC(c, () => window.skyCrew.debug.cam(null));
  await at(c, 0, 8); // the stairs + rear door are covered by sky-crew.mjs; hop into the cabin
  check(await waitT(c, (t) => t.step === 'boarded' && /Aboard/.test(t.docs)), `${tag}: aboard`);
}

// ================= solo =================
const A = await mk('solo', 'low', 4);
await boot(A);
await tap(A, '#bSolo'); await A.p.waitForFunction(() => window.skyCrew.state().playing, null, { polling: 250 });
let T0 = await term(A), s0 = await st(A);
check(T0.active && T0.step === 'none' && s0.me.z > 58, `solo: spawn at the terminal entrance with a passport (z=${s0.me.z.toFixed(1)}, ${T0.docs})`);
check(T0.paxInTerminal >= 10, `solo: passengers queue through the terminal (${T0.paxInTerminal} in the hall)`);
await shot(A, 'solo-entrance');
// no skipping: the arch and the gate are physically closed, and the plane won't leave
let blocked = await SC(A, () => window.skyCrew.debug.colsAt(1.6, -2.4, 44).map((c) => c.tag));
check(blocked.includes('term:arch'), `solo: can't walk through the scanner without checking in (${blocked})`);
let dep = await tryDepart(A);
check(dep.phase === 'boarding' && dep.speed < 0.5, `solo: plane holds at the gate until the crew boards (${JSON.stringify(dep)})`);
await SC(A, () => window.skyCrew.leaveSeat());
const tStart = Date.now();
await walkThrough(A, 'solo');
dep = await tryDepart(A, 4000);
check(dep.phase !== 'boarding' || dep.speed > 0.5, `solo: once aboard the plane can depart (${JSON.stringify(dep)})`);
ok(`solo walk-through took ${((Date.now() - tStart) / 1000).toFixed(0)} s in the test harness (teleports between desks)`);
// Skip airport setting (persists) -> straight to the apron
await SC(A, () => localStorage.setItem('skycrew.skipAirport', '1'));
await boot(A); await tap(A, '#bSolo'); await A.p.waitForFunction(() => window.skyCrew.state().playing, null, { polling: 250 });
T0 = await term(A); s0 = await st(A);
check(!T0.airport && T0.crew.ready && s0.me.z < 22, `solo: "Skip the airport" spawns on the apron and needs no checks (z=${s0.me.z.toFixed(1)})`);
check(await A.p.$eval('#setSkipAirport', (e) => e.checked), 'settings checkbox shows "Skip the airport" on');
await SC(A, () => localStorage.removeItem('skycrew.skipAirport'));
await A.ctx.close();

// ================= co-op (2 signed-in players) =================
const H = await mk('host', 'low', 3), G = await mk('guest', 'low', 2);
const n = Date.now() % 100000;
await login(H, `e2e_th${n}`, PW, true); await login(G, `e2e_tg${n}`, PW, true);
await boot(H); await boot(G);
await H.p.waitForSelector('#bJoin:not([disabled])'); await G.p.waitForSelector('#bJoin:not([disabled])');
await tap(H, '#bCreate'); await H.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { polling: 250, timeout: 15000 });
const code = (await st(H)).room.code;
await G.p.fill('#joinCode', code); await tap(G, '#bJoin'); await G.p.waitForFunction(() => window.skyCrew.state().room, null, { polling: 250, timeout: 15000 });
check(await G.p.$eval('#lobSkipAirport', (e) => e.disabled), 'co-op: only the host can tick "Skip the airport" in the lobby');
let e1 = await raw(G, { t: 'airport', skip: true });
check(e1?.code === 'not_host', `co-op: forged skip from a guest -> ${e1?.code}`);
for (const c of [H, G]) await tap(c, '#bBoard');
for (const c of [H, G]) await c.p.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 1, null, { polling: 250, timeout: 30000 });
e1 = await raw(G, { t: 'term', step: 'gate' });
check(e1?.code === 'term_order', `co-op: forged "gate" step without check-in -> ${e1?.code}`);
e1 = await raw(G, { t: 'term', step: 'boarded' });
check(e1?.code === 'term_order', `co-op: forged "boarded" -> ${e1?.code}`);
await at(G, 0, 58); await sleep(1800); e1 = await raw(G, { t: 'term', step: 'checkin' });
check(e1?.code === 'term_far', `co-op: check-in from across the hall -> ${e1?.code}`);
await walkThrough(H, 'coop-host');
const rows = await H.p.$$eval('#obj .o', (els) => els.map((e) => e.textContent));
check(rows.some((r) => /Crew aboard 1\/2/.test(r)), `co-op: ready indicator shows 1/2 aboard (${rows.find((r) => /Crew aboard/.test(r))})`);
await shot(H, 'coop-waiting-for-crew');
dep = await tryDepart(H);
check(dep.phase === 'boarding' && dep.speed < 0.5, `co-op: host can't depart while the guest is still in the terminal (${JSON.stringify(dep)})`);
await SC(H, () => window.skyCrew.leaveSeat());
await walkThrough(G, 'coop-guest');
check(await waitT(H, (t) => t.crew.ready), 'co-op: host sees the whole crew aboard');
dep = await tryDepart(H, 4000);
check(dep.phase !== 'boarding' || dep.speed > 0.5, `co-op: with everyone aboard the plane departs (${JSON.stringify(dep)})`);
const au = await api(H.p, 'GET', '/api/admin/audit?limit=5');
check(au.status === 403, 'co-op: (players cannot read the audit log)');
// the host's saved "Skip the airport" carries into a new room, and every client sees it
await G.p.evaluate(() => localStorage.setItem('skycrew.skipAirport', '1'));
await G.p.reload(); await G.p.waitForSelector('#bJoin:not([disabled])');
await tap(G, '#bCreate'); await G.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { polling: 250, timeout: 15000 });
await sleep(800);
const T2 = await SC(G, () => window.skyCrew.term());
const r2 = await st(G);
check(r2.room.airport === false && T2.airport === false && await G.p.$eval('#lobSkipAirport', (e) => e.checked), `co-op: host's saved "Skip the airport" applies to the new room (room.airport=${r2.room.airport})`);
for (const e of [...errs]) if (/403/.test(e)) errs.splice(errs.indexOf(e), 1);

console.log(`\n${report.length} passed, ${fail.length} failed`);
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
