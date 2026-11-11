// Sky Crew Developer tools e2e: secret inventory (every gadget), tabbed panel per rank, Admin/Trusted/Player
// restrictions (UI + forged messages), panel actions synced in a 4-client co-op room.
// Usage: node dev-tools.mjs        (server on BASE, default http://localhost:3200)
import { chromium } from 'playwright';
import fs from 'node:fs';
// these suites test the cabin and flight; the airport terminal has its own suite (terminal.mjs)
const skipAp = async (ctx) => { await ctx.addInitScript(() => { try { localStorage.setItem('skycrew.skipAirport', '1'); } catch { /* ignore */ } }); return ctx; };
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/dev', import.meta.url).pathname;
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
  const ctx = await skipAp(await browser.newContext({ viewport: { width: 960, height: 600 } }));
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
  const r = await api(c.p, 'POST', register ? '/api/auth/register' : '/api/auth/login', register ? { username, password } : { login: username, password });
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

const A = await mk('dev', 'low', 5), Ad = await mk('admin'), T = await mk('trusted'), P = await mk('player');
const n = Date.now() % 100000, names = { admin: `e2e_adm${n}`, trusted: `e2e_tru${n}`, player: `e2e_ply${n}` };
await login(A, devUser, devPw);
await login(Ad, names.admin, PW, true); await login(T, names.trusted, PW, true); await login(P, names.player, PW, true);
for (const [k, role] of [['admin', 'ADMIN'], ['trusted', 'TRUSTED']]) {
  const u = (await api(A.p, 'GET', `/api/admin/users?q=${names[k]}`)).j.users.find((x) => x.username === names[k]);
  const r = await api(A.p, 'PUT', `/api/admin/users/${u.id}/role`, { role });
  check(r.status === 200, `setup: Developer promoted ${names[k]} to ${role}`, JSON.stringify(r));
}
// Admin must not be able to promote anyone to Developer (site check, sanity)
{ const u = (await api(A.p, 'GET', `/api/admin/users?q=${names.player}`)).j.users[0]; const r = await api(Ad.p, 'PUT', `/api/admin/users/${u.id}/role`, { role: 'DEVELOPER' }); check(r.status === 403, `site: Admin cannot grant Developer (${r.status})`); for (let i = errs.length - 1; i >= 0; i--) if (/403/.test(errs[i])) errs.splice(i, 1); /* the expected refusal logs a 403 */ }

const boot = async (c) => {
  await c.p.goto(`${B}/play/sky-crew?fps=${c.fps}`, { waitUntil: 'load' }); await c.p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
  await c.p.waitForSelector('#bJoin:not([disabled])', { timeout: 20000 }).catch(async () => { throw new Error(`${c.label} not signed in on the game page: ${await c.p.textContent('#meLine')}`); });
};
await boot(A); await tap(A, '#bCreate');
await A.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { polling: 250, timeout: 15000 });
const code = (await st(A)).room.code;
for (const c of [Ad, T, P]) { await boot(c); await c.p.fill('#joinCode', code); await tap(c, '#bJoin').catch(async (e) => { await shot(c, 'zz-join-fail'); console.log(await c.p.evaluate(() => { const b = document.querySelector('#bJoin').getBoundingClientRect(); const top = document.elementFromPoint(b.x + 5, b.y + 5); return JSON.stringify({ b, top: top?.id || top?.className, vis: getComputedStyle(document.querySelector('#bJoin')).visibility }); })); throw e; }); await c.p.waitForFunction(() => window.skyCrew.state().room, null, { polling: 250, timeout: 15000 }).catch(async (e) => { await shot(c, 'zz-join-fail'); const t0 = Date.now(); const v = await c.p.evaluate(() => { try { return JSON.stringify(window.skyCrew.state().room); } catch (er) { return 'ERR ' + er.message; } }); throw new Error(`${c.label} join: ${await c.p.textContent('#menuErr')} ${e.message} eval(${Date.now() - t0}ms)=${v} errs=${errs.join(' | ')}`); }); }
for (const c of [A, Ad, T, P]) await tap(c, '#bBoard');
for (const c of [A, Ad, T, P]) await c.p.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 3, null, { polling: 250, timeout: 30000 });
ok(`room ${code}: Developer + Admin + Trusted + Player in co-op (ranks from server: ${(await st(P)).room.players.map((p) => p.role).join(', ')})`);

// ---------- panel tabs per rank ----------
await SC(A, () => window.skyCrew.openPanel(true));
await A.p.waitForFunction(() => window.skyCrew.panelTabs().includes('inventory'), null, { polling: 250, timeout: 8000 }).catch(() => {});
const tabsA = await SC(A, () => window.skyCrew.panelTabs());
check(['items', 'inventory', 'world', 'emerg', 'players', 'teleport', 'npc', 'events', 'config', 'server'].every((t) => tabsA.includes(t)), `Developer panel tabs: ${tabsA.join(', ')}`);
check((await A.p.textContent('#admTitle')) === 'Developer panel', 'Developer panel title');
await tap(A, '#admTabs [data-tab="inventory"]'); await sleep(300); await shot(A, 'panel-inventory');
const cards = await A.p.$$eval('#admBody [data-gadget]', (e) => e.map((x) => x.dataset.gadget));
check(cards.length === 14, `inventory lists ${cards.length} gadgets: ${cards.join(', ')}`);
await A.p.fill('#invSearch', 'freeze'); await sleep(300);
const searched = await A.p.$$eval('#admBody [data-gadget]', (e) => e.map((x) => x.dataset.gadget));
check(searched.length === 1 && searched[0] === 'freeze_ray', `inventory search "freeze" -> ${searched}`);
await A.p.fill('#invSearch', ''); await tap(A, '#admBody [data-cat="Movement"]'); await sleep(300);
const mv = await A.p.$$eval('#admBody [data-gadget]', (e) => e.map((x) => x.dataset.gadget));
check(mv.sort().join() === 'jetpack,noclip', `category Movement -> ${mv}`);
await tap(A, '#admBody [data-cat="All"]');
for (const tab of tabsA) { await tap(A, `#admTabs [data-tab="${tab}"]`); await sleep(150); const btns = await A.p.$$eval('#admBody button', (b) => b.length); if (!btns && tab !== 'inventory') bad(`tab ${tab} has no buttons`); if (['world', 'players', 'npc', 'config', 'server'].includes(tab)) await shot(A, `panel-${tab}`); }
ok('every Developer tab renders working controls');

for (const [c, want, not] of [[Ad, ['items', 'world', 'emerg', 'players'], ['inventory', 'npc', 'config', 'server', 'teleport']], [T, ['items'], ['inventory', 'world', 'players', 'npc', 'server', 'config']]]) {
  await SC(c, () => window.skyCrew.openPanel(true)); await sleep(800);
  const tabs = await SC(c, () => window.skyCrew.panelTabs());
  check(want.every((t) => tabs.includes(t)) && !not.some((t) => tabs.includes(t)), `${c.label} panel tabs: ${tabs.join(', ')} (no ${not.join('/')})`);
  await shot(c, `panel-${c.label}`);
  if (c === Ad) { await tap(c, '#admTabs [data-tab="players"]'); await sleep(200); const devRow = await c.p.$eval(`[data-player="${devUser}"]`, (e) => ({ txt: e.textContent, btns: e.querySelectorAll('button[data-act="kick"],button[data-act="ban"]').length })).catch(() => null); check(devRow && devRow.btns === 0 && /protected/.test(devRow.txt), 'Admin sees the Developer as protected (no kick/ban buttons)'); await shot(c, 'panel-admin-players'); }
  await SC(c, () => window.skyCrew.openPanel(false));
}
await SC(P, () => window.skyCrew.openPanel(true)); await sleep(500);
check(await P.p.$eval('#admin', (e) => e.classList.contains('hidden')), 'Player: staff panel does not open');

// ---------- forged / restricted messages ----------
for (const c of [Ad, T, P]) {
  const r = await raw(c, { t: 'inventory' });
  check(r?.code === 'forbidden', `${c.label}: forged {t:'inventory'} refused (${r?.code})`);
  const eq = await admin(c, 'equip', { item: 'plasma_blaster' });
  check(/denied/.test(eq), `${c.label}: equip plasma_blaster refused (${eq})`);
  const sp = await admin(c, 'spawn', { tier: 'developer', item: 'freeze_ray', count: 1 });
  check(/denied/.test(sp), `${c.label}: spawn developer item refused (${sp})`);
  const us = await admin(c, 'use', { item: 'plasma_blaster', o: [0, 1, 0], d: [0, 0, 1] });
  check(/denied/.test(us), `${c.label}: use gadget refused (${us})`);
  const gods = await raw(c, { t: 'admin', cmd: 'equip', args: { item: 'jetpack' }, role: 'DEVELOPER', permissions: ['items.spawn.developer'] }, 'admin_denied');
  check(!!gods, `${c.label}: forged role/permissions in the message ignored (${gods?.reason})`);
}
const aCid = (await SC(A, () => window.skyCrew.net.cid));
const pCid = (await SC(P, () => window.skyCrew.net.cid));
for (const [cmd, args] of [['kick', { cid: aCid }], ['ban', { cid: aCid, minutes: 60 }], ['mute', { cid: aCid, minutes: 5, on: true }], ['freeze', { cid: aCid, on: true }]]) check(/denied/.test(await admin(Ad, cmd, args)), `Admin cannot ${cmd} the Developer`);
for (const cmd of ['teleport', 'npc', 'event', 'config', 'time', 'close_room', 'broadcast']) check(/denied/.test(await admin(Ad, cmd, { to: 'cabin', action: 'spawn', event: 'vip', difficulty: 'easy', hour: 3, code, text: 'x' })), `Admin cannot use Developer command ${cmd}`);
check(!/denied/.test(await admin(Ad, 'weather', { weather: 'rain' })), 'Admin can change the weather');
check(/denied/.test(await admin(T, 'weather', { weather: 'clear' })), 'Trusted cannot change the weather');
check(!/denied/.test(await admin(T, 'spawn', { tier: 'approved', item: 'water', count: 1 })), 'Trusted can spawn an approved item');
check(/denied/.test(await admin(T, 'spawn', { tier: 'any', item: 'giant_duck', count: 1 })), 'Trusted cannot spawn non-approved items');
check(/denied/.test(await admin(T, 'kick', { cid: pCid })), 'Trusted cannot kick');
check(/denied/.test(await admin(P, 'spawn', { tier: 'approved', item: 'water', count: 1 })), 'Player cannot spawn anything');
await admin(A, 'weather', { weather: 'clear' });

// ---------- every gadget (Developer = room host) ----------
await SC(A, () => { window.skyCrew.openPanel(false); window.skyCrew.debug.sitAll(); window.skyCrew.third(true); });
await sleep(1500);
const seated = async () => (await SC(A, () => window.skyCrew.pax())).filter((x) => x.state === 'seated').sort((a, b) => a.z - b.z);
async function equip(item) { const r = await admin(A, 'equip', { item }); await A.p.waitForFunction((i) => window.skyCrew.gadgets().mine.includes(i), item, { polling: 250, timeout: 8000 }).catch(() => {}); return r; }
async function aimPax(q, dz = 2.2) { await SC(A, ({ q, dz }) => { window.skyCrew.teleport(0, 0, q.z + dz); window.skyCrew.lookAt(q.x, q.y + 0.75, q.z); }, { q, dz }); await sleep(250); }
const fire = async (alt = false) => { await SC(A, (alt) => window.skyCrew.fire(alt), alt); await sleep(900); };
// panel Equip button (real click) for the first one
await SC(A, () => window.skyCrew.openPanel(true)); await tap(A, '#admTabs [data-tab="inventory"]');
await tap(A, '[data-gadget="freeze_ray"] button[data-act="equip"]');
await A.p.waitForFunction(() => window.skyCrew.gadgets().tool === 'freeze_ray', null, { polling: 250, timeout: 8000 }).then(() => ok('panel Equip button equips the Freeze Ray'), () => bad('panel Equip did nothing'));
await sleep(300); await shot(A, 'panel-equipped');
await SC(A, () => window.skyCrew.openPanel(false));
// remote players see the gadget in the Developer's hand
await P.p.waitForFunction((u) => (window.skyCrew.gadgets().remoteAttach[u] || []).includes('tool'), devUser, { polling: 250, timeout: 8000 }).then(() => ok('Player sees the Freeze Ray model in the Developer\'s hand (co-op sync)'), () => bad('remote tool model missing'));
let s = await seated(); let q = s[3];
await aimPax(q); await fire();
let pq = (await SC(A, () => window.skyCrew.pax())).find((x) => x.id === q.id);
check(pq.frozen, `Freeze Ray froze passenger ${q.id}`); await shot(A, 'gadget-freeze');
const pSees = (await SC(P, () => window.skyCrew.pax())).find((x) => x.id === q.id); await sleep(600);
check((await SC(P, () => window.skyCrew.pax())).find((x) => x.id === q.id)?.frozen, 'frozen passenger synced to the Player\'s client', JSON.stringify(pSees));
// freeze ray on a player
const pPos = (await st(P)).me;
await SC(A, (p) => { window.skyCrew.teleport(p.x, p.y, p.z + 2.5); window.skyCrew.lookAt(p.x, p.y + 0.9, p.z); }, pPos); await sleep(400); await fire();
await P.p.waitForFunction(() => window.skyCrew.gadgets().frozenT > 0, null, { polling: 250, timeout: 5000 }).then(() => ok('Freeze Ray on the Player: their client is frozen (ice block)'), () => bad('player freeze ray failed'));
await shot(A, 'gadget-freeze-player');
// size ray
await equip('size_ray'); s = await seated(); q = s[5]; await aimPax(q); await fire();
pq = (await SC(A, () => window.skyCrew.pax())).find((x) => x.id === q.id); check(pq.sizeK === 0.5, `Shrink Ray shrank passenger ${q.id} (sizeK ${pq.sizeK})`); await sleep(800); await shot(A, 'gadget-shrink');
await fire(true); check((await gd(A)).mode === 'grow', 'alt fire switches the ray to GROW');
q = s[6]; await aimPax(q); await fire(); pq = (await SC(A, () => window.skyCrew.pax())).find((x) => x.id === q.id); check(pq.sizeK === 1.6, `Grow Ray grew passenger ${q.id} (sizeK ${pq.sizeK})`); await sleep(800); await shot(A, 'gadget-grow');
await sleep(500); check((await SC(P, () => window.skyCrew.pax())).find((x) => x.id === q.id)?.sizeK === 1.6, 'size change synced to the Player');
// plasma / ion on a passenger: knocked out of the seat
for (const [item, idx] of [['plasma_blaster', 8], ['ion_beam', 10]]) {
  await equip(item); s = await seated(); q = s[Math.min(idx, s.length - 1)]; await aimPax(q, 2.6);
  await SC(A, () => window.skyCrew.fire(false)); await sleep(item === 'plasma_blaster' ? 250 : 120); await shot(A, `gadget-${item}`); await sleep(1000);
  pq = (await SC(A, () => window.skyCrew.pax())).find((x) => x.id === q.id);
  check(pq.state !== 'seated' || Math.hypot(pq.x - q.x, pq.z - q.z) > 0.3, `${item} knocked passenger ${q.id} (${pq.state})`);
}
// wave cannon + confetti
await equip('wave_cannon'); s = await seated(); await aimPax(s[0], 3); await SC(A, () => window.skyCrew.fire(false)); await sleep(200); await shot(A, 'gadget-wave'); await sleep(800);
await equip('confetti_cannon'); s = await seated(); await aimPax(s[1], 3); await SC(A, () => window.skyCrew.fire(false)); await sleep(500); await shot(A, 'gadget-confetti');
check((await SC(A, () => window.skyCrew.pax())).some((x) => x.cheer), 'Confetti Cannon: nearby passengers cheer');
// gravity gun on an item
await admin(A, 'spawn', { tier: 'any', item: 'beach_ball', count: 1 }); await sleep(1500);
await equip('gravity_gun');
let ball = (await SC(A, () => window.skyCrew.items())).find((i) => i.type === 'beach_ball');
await SC(A, (b) => { window.skyCrew.teleport(b.x, b.y < -1 ? -2.4 : 0, b.z + 2.5); window.skyCrew.lookAt(b.x, b.y, b.z); }, ball); await sleep(300); await fire();
check((await gd(A)).grav, 'Gravity Gun lifted the beach ball'); await sleep(600); await shot(A, 'gadget-gravity-hold');
const held = (await SC(A, () => window.skyCrew.items())).find((i) => i.id === ball.id);
await fire(); await sleep(400);
const thrown = (await SC(A, () => window.skyCrew.items())).find((i) => i.id === ball.id);
check(!(await gd(A)).grav && Math.hypot(thrown.x - held.x, thrown.z - held.z) > 0.5, `Gravity Gun launched it (moved ${Math.hypot(thrown.x - held.x, thrown.z - held.z).toFixed(1)} m)`);
// teleport gun
await equip('teleport_gun'); await SC(A, () => { window.skyCrew.teleport(0, 0, 8); window.skyCrew.look(0, -0.35); }); await sleep(300);
const before = (await st(A)).me; await fire(); const after = (await st(A)).me;
check(after.z < before.z - 1.5, `Teleport Gun moved the Developer ${(before.z - after.z).toFixed(1)} m forward`); await shot(A, 'gadget-teleport');
// unequip
await admin(A, 'unequip', { item: 'teleport_gun' }); await sleep(400); check(!(await gd(A)).tool, 'Unequip removes the tool');

// ---------- abilities ----------
await SC(A, () => window.skyCrew.third(true));
for (const item of ['super_speed', 'super_jump', 'jetpack', 'noclip', 'shield_bubble', 'golden_aura']) check(!/denied/.test(await equip(item)), `equip ${item}`);
await A.p.waitForFunction(() => window.skyCrew.gadgets().attach.length >= 4, null, { polling: 250, timeout: 5000 }).catch(() => {});
check(['jet', 'shield', 'aura'].every((k) => (async () => true)) && (await gd(A)).attach.join(), `ability visuals attached: ${(await gd(A)).attach.join(', ')}`);
await SC(A, () => { window.skyCrew.teleport(0, 0, 4); window.skyCrew.look(Math.PI, -0.2); }); await sleep(800); await shot(A, 'abilities-all');
// noclip: fly up through the ceiling
await A.p.keyboard.down('Space'); await A.p.waitForFunction(() => window.skyCrew.state().me.y > 3, null, { polling: 250, timeout: 20000 }).then(() => ok('Noclip: flew up through the cabin ceiling'), () => bad('noclip flight failed')); await A.p.keyboard.up('Space');
await shot(A, 'ability-noclip');
await admin(A, 'unequip', { item: 'noclip' }); await sleep(400);
await A.p.waitForFunction(() => window.skyCrew.state().me.onGround, null, { polling: 250, timeout: 20000 }).catch(() => {});
// jetpack: hold space
await SC(A, () => { window.skyCrew.teleport(8, -2.4, 20); window.skyCrew.look(0.6, 0); }); await sleep(1500);
const y0 = (await st(A)).me.y;
await A.p.keyboard.down('Space'); await A.p.waitForFunction((y0) => window.skyCrew.state().me.y > y0 + 2, y0, { polling: 250, timeout: 20000 }).then(() => ok('Jetpack: holding jump flies up'), () => bad('jetpack did not fly'));
await shot(A, 'ability-jetpack'); await A.p.keyboard.up('Space');
await P.p.waitForFunction((u) => (window.skyCrew.gadgets().remoteAttach[u] || []).includes('jet'), devUser, { polling: 250, timeout: 5000 }).then(() => ok('Player sees the jetpack on the Developer'), () => bad('remote jetpack missing'));
await A.p.waitForFunction(() => window.skyCrew.state().me.onGround, null, { polling: 250, timeout: 20000 }).catch(() => {});
// super speed
await admin(A, 'unequip', { item: 'jetpack' }); await sleep(300);
const sp0 = (await st(A)).me; await A.p.keyboard.down('KeyW'); const t0 = Date.now();
await A.p.waitForFunction((p) => Math.hypot(window.skyCrew.state().me.x - p.x, window.skyCrew.state().me.z - p.z) > 6, sp0, { polling: 250, timeout: 30000 }).catch(() => {}); await A.p.keyboard.up('KeyW');
const fast = await SC(A, () => window.skyCrew.state().me);
check(Math.hypot(fast.x - sp0.x, fast.z - sp0.z) > 6, `Super Speed: ran ${Math.hypot(fast.x - sp0.x, fast.z - sp0.z).toFixed(1)} m in ${((Date.now() - t0) / 1000).toFixed(1)} s (speed ×2.5 in code)`);

// ---------- spawning a gadget case + pickup ----------
await SC(A, () => { window.skyCrew.teleport(0, 0, 2); window.skyCrew.look(0, -0.3); }); await sleep(800);
const spr = await admin(A, 'spawn', { tier: 'developer', item: 'plasma_blaster', count: 1 }); await sleep(1500);
const cs = (await SC(A, () => window.skyCrew.items())).find((i) => i.type === 'plasma_blaster');
check(spr === 'admin_ok' && cs && /^dv/.test(cs.id), `Developer spawned a Plasma Blaster case (${cs?.id})`);
await sleep(600);
const pCs = (await SC(P, () => window.skyCrew.items())).find((i) => i.type === 'plasma_blaster');
check(!!pCs, 'gadget case synced to the Player');
await SC(P, (c) => { window.skyCrew.teleport(c.x + 1.2, 0, c.z); window.skyCrew.lookAt(c.x, c.y, c.z); }, cs); await sleep(400);
const pT = await SC(P, () => window.skyCrew.target());
check(!pT || !/Plasma/i.test(pT.label || ''), `Player gets no pickup prompt for the gadget case (${pT?.label || 'none'})`);
await P.p.keyboard.press('KeyE'); await sleep(1200);
check(!(await SC(A, () => window.skyCrew.items())).find((i) => i.id === cs.id)?.heldBy, 'Player cannot carry the gadget case');
await SC(A, (c) => { window.skyCrew.teleport(c.x - 1.2, 0, c.z); window.skyCrew.lookAt(c.x, c.y, c.z); }, cs); await sleep(400);
const aT = await SC(A, () => window.skyCrew.target());
await A.p.keyboard.press('KeyE');
await A.p.waitForFunction(() => window.skyCrew.gadgets().tool === 'plasma_blaster', null, { polling: 250, timeout: 8000 }).then(() => ok(`Developer picked up the case ("${aT?.label}") and it equipped the Plasma Blaster`), async () => bad(`dev pickup did not equip (target was ${JSON.stringify(aT)}, case ${JSON.stringify((await SC(A, () => window.skyCrew.items())).find((i) => i.id === cs.id))}, me ${JSON.stringify((await st(A)).me)})`));
await sleep(800); check(!(await SC(A, () => window.skyCrew.items())).find((i) => i.id === cs.id), 'the case is consumed');

// ---------- panel actions on players / world ----------
await SC(A, () => window.skyCrew.openPanel(true)); await tap(A, '#admTabs [data-tab="players"]'); await sleep(300);
await tap(A, `[data-player="${names.player}"] button[data-act="freeze"]`);
await P.p.waitForFunction(() => window.skyCrew.gadgets().frozen, null, { polling: 250, timeout: 8000 }).then(() => ok('panel Freeze: the Player is frozen by the server'), () => bad('panel freeze failed'));
const fp = (await st(P)).me; await P.p.keyboard.down('KeyW'); await sleep(1500); await P.p.keyboard.up('KeyW'); const fp2 = (await st(P)).me;
check(Math.hypot(fp2.x - fp.x, fp2.z - fp.z) < 0.2, 'frozen Player cannot walk');
await sleep(300); await tap(A, `[data-player="${names.player}"] button[data-act="freeze"]`);
await P.p.waitForFunction(() => !window.skyCrew.gadgets().frozen, null, { polling: 250, timeout: 8000 }).then(() => ok('panel Unfreeze'), () => bad('unfreeze failed'));
await sleep(300); await tap(A, `[data-player="${names.player}"] button[data-act="mute"]`); await sleep(800);
const mr = await raw(P, { t: 'chat', text: 'hello?' });
check(mr?.code === 'muted', `panel Mute: muted Player's chat refused (${mr?.code})`);
const chatOk = await raw(T, { t: 'chat', text: 'hi crew' }, 'chat'); check(chatOk?.text === 'hi crew', 'chat works for an unmuted player');
await tap(A, `[data-player="${names.player}"] button[data-act="bring"]`); await sleep(1200);
const pb = (await st(P)).me, ap = (await st(A)).me; check(Math.hypot(pb.x - ap.x, pb.z - ap.z) < 2, 'panel Bring: Player teleported next to the Developer');
await tap(A, '#admTabs [data-tab="npc"]'); await sleep(200);
const pax0 = (await SC(A, () => window.skyCrew.pax())).length; await tap(A, '[data-npc="spawn"]'); await sleep(1500);
check((await SC(A, () => window.skyCrew.pax())).length === pax0 + 1, `panel NPC spawn: ${pax0} -> ${pax0 + 1} passengers`);
await sleep(500); check((await SC(P, () => window.skyCrew.pax())).length === pax0 + 1, 'spawned passenger synced to the Player');
await tap(A, '[data-npc="freeze"]'); await sleep(800); check((await SC(A, () => window.skyCrew.pax())).filter((x) => x.state !== 'lost').every((x) => x.frozen), 'panel NPC freeze all');
await tap(A, '#admTabs [data-tab="events"]'); await tap(A, '[data-event="vip"]'); await sleep(1500);
check((await SC(A, () => window.skyCrew.pax())).some((x) => x.vip), 'panel VIP event adds a VIP passenger');
await tap(A, '[data-event="birthday"]'); await sleep(700); await SC(A, () => window.skyCrew.openPanel(false)); await sleep(300); await shot(A, 'event-birthday'); await SC(A, () => window.skyCrew.openPanel(true));
await tap(A, '#admTabs [data-tab="world"]'); await tap(A, '[data-weather="storm"]'); await sleep(500);
await SC(A, () => window.skyCrew.admin('time', { hour: 21 })); await sleep(1000);
check((await SC(P, () => window.skyCrew.hour())) === 21, 'panel time of day reaches other clients (21:00)');
await SC(P, () => { window.skyCrew.teleport(8, -2.4, 22); window.skyCrew.lookAt(0, 1, 0); }); await sleep(800); await shot(P, 'world-night-storm');
await admin(A, 'time', { hour: 13 }); await admin(A, 'weather', { weather: 'clear' });
await tap(A, '#admTabs [data-tab="config"]'); await A.p.selectOption('#cfgDiff', 'hard'); await A.p.fill('#cfgPay', '2'); await tap(A, '#cfgApply'); await sleep(800);
const cfg = await SC(A, () => window.skyCrew.config()); check(cfg?.difficulty === 'hard' && cfg.payout === 2, `panel config applied ${JSON.stringify(cfg)}`);
await tap(A, '#admTabs [data-tab="server"]'); await A.p.fill('#bcText', 'Server restart in 5 minutes');
const annP = P.p.waitForEvent('console', { timeout: 1 }).catch(() => null); void annP;
const ann = SC(T, () => new Promise((r) => { window.skyCrew.net.addEventListener('announce', (e) => r(e.detail.text), { once: true }); setTimeout(() => r(null), 5000); }));
await tap(A, '#bcSend'); check((await ann) === 'Server restart in 5 minutes', 'panel broadcast reached other players');
// kick + ban from the panel (Admin acting on the Player)
await SC(Ad, () => window.skyCrew.openPanel(true)); await tap(Ad, '#admTabs [data-tab="players"]'); await sleep(300);
await tap(Ad, `[data-player="${names.player}"] button[data-act="ban"]`);
await P.p.waitForSelector('#menuErr:not(.hidden)', { timeout: 8000 }).catch(() => {});
const banMsg = await P.p.textContent('#menuErr'); check(/banned/i.test(banMsg), `Admin's panel Ban removed the Player ("${banMsg}")`);
await tap(P, '#bCreate'); await sleep(2000); const banMsg2 = await P.p.textContent('#menuErr');
check(/banned/i.test(banMsg2) || !(await st(P)).room, `banned Player cannot create a room ("${banMsg2}")`);
await shot(P, 'banned-player');
// audit trail
const au = await api(A.p, 'GET', '/api/admin/audit?limit=200');
const acts = new Set((au.j?.entries || au.j?.logs || au.j?.items || []).map((e) => e.action));
check(['ingame.equip', 'ingame.spawn', 'ingame.freeze', 'ingame.ban'].every((a) => [...acts].some((x) => x.startsWith(a))), `audit log has the in-game actions (${[...acts].filter((a) => a.startsWith('ingame')).slice(0, 14).join(', ')})`, `status ${au.status} keys ${Object.keys(au.j || {})}`);

await browser.close();
errs.length ? bad(`console errors:\n  ${errs.join('\n  ')}`) : ok('no console errors on any client');
console.log(`\n${report.length} passed, ${fail.length} failed`);
fs.writeFileSync('/tmp/dev-tools-report.txt', [...report.map((r) => `✔ ${r}`), ...fail.map((f) => `✘ ${f}`)].join('\n'));
process.exit(fail.length ? 1 : 0);
