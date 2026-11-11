// Sky Crew economy e2e: wallet, shop (buy/wear), outfits synced in co-op, classes, Developer grants, forged messages.
import { chromium } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/economy', import.meta.url).pathname;
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


const A = await mk('dev', 'low', 2), P1 = await mk('p1', 'low', 3), P2 = await mk('p2');
const n = Date.now() % 100000, u1 = `e2e_eco${n}`, u2 = `e2e_ecb${n}`;
await login(A, devUser, devPw); await login(P1, u1, PW, true); await login(P2, u2, PW, true);
const boot = async (c) => {
  await c.p.goto(`${B}/play/sky-crew?fps=${c.fps}`, { waitUntil: 'load' }); await c.p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
  await c.p.waitForSelector('#bJoin:not([disabled])', { timeout: 20000 });
};
const look = (c) => SC(c, () => window.skyCrew.locker());
const waitLook = async (c, fn, arg, ms = 10000) => { const t0 = Date.now(); let l; while (Date.now() - t0 < ms) { l = await look(c).catch(() => null); if (l && fn(l, arg)) return true; await sleep(300); } console.log('   last look:', JSON.stringify(l).slice(0, 300)); return false; };
for (const c of [A, P1, P2]) await boot(c);

// ---------- new account: starters only, 0 credits ----------
let L = await look(P1);
check(L.signedIn && L.balance === 0 && !L.ownsAll, `new player starts with ₵0 (balance ${L.balance})`);
await SC(P1, () => window.skyCrew.openShop('outfit'));
await P1.p.waitForSelector('#shop:not(.hidden) [data-item="outfit:dino"]', { timeout: 8000 });
const dinoBtn = await P1.p.$eval('[data-item="outfit:dino"] button', (b) => ({ t: b.textContent, dis: b.disabled }));
check(dinoBtn.dis && /Buy/.test(dinoBtn.t), `locked outfit shows a disabled "Buy" button when broke (${dinoBtn.t})`);
check(await P1.p.$('[data-item="outfit:hoodie"] [data-use]') != null, 'free starter (hoodie) can be worn right away');
await tap(P1, '[data-item="outfit:hoodie"] [data-use]');
check(await waitLook(P1, (l) => l.outfit.outfit === 'hoodie' && l.avatarOutfit?.outfit === 'hoodie'), 'wearing the hoodie rebuilds my character');
await sleep(600);
let o = await api(P1.p, 'GET', '/api/game/sky-crew/outfit');
check(o.j?.outfit?.outfit === 'hoodie', `outfit saved on the server (${JSON.stringify(o.j?.outfit)})`);
// forged purchases / wear
let r = await api(P1.p, 'POST', '/api/game/sky-crew/shop/buy', { item: 'class:ace_pilot', purchaseId: `forge${n}aaaa` });
check(r.status === 402 && r.j.code === 'insufficient_funds', `buying a class with ₵0 -> ${r.status} ${r.j?.code}`);
r = await api(P1.p, 'POST', '/api/game/sky-crew/shop/buy', { item: 'class:god_mode', purchaseId: `forge${n}bbbb` });
check(r.status === 404, `unknown item -> ${r.status}`);
r = await api(P1.p, 'PUT', '/api/game/sky-crew/outfit', { outfit: { outfit: 'dino', hat: 'tophat', color: 7, skin: 0 } });
check(r.status === 403, `wearing an unowned outfit via the API -> ${r.status}`);
for (const e of [...errs]) if (/40[234]/.test(e)) errs.splice(errs.indexOf(e), 1); // expected refusals logged by the browser
await shot(P1, 'shop-outfits-broke');
await tap(P1, '#shopClose');

// ---------- co-op room ----------
await tap(A, '#bCreate');
await A.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { polling: 250, timeout: 15000 });
const code = (await st(A)).room.code;
for (const c of [P1, P2]) { await c.p.fill('#joinCode', code); await tap(c, '#bJoin'); await c.p.waitForFunction(() => window.skyCrew.state().room, null, { polling: 250, timeout: 15000 }); }
for (const c of [A, P1, P2]) await tap(c, '#bBoard');
for (const c of [A, P1, P2]) await c.p.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 2, null, { polling: 250, timeout: 30000 });
ok(`room ${code}: Developer + 2 players`);
check(await waitLook(P2, (l, u) => l.remotes.some((x) => x.username === u && x.key.includes('"hoodie"')), u1), 'other players see my saved outfit (hoodie)');
// forged WS messages
let e1 = await raw(P1, { t: 'class', id: 'ace_pilot' });
check(e1?.code === 'not_owned', `forged class pick (not owned) -> ${e1?.code}`);
e1 = await raw(P1, { t: 'class', id: 'superman' });
check(e1?.code === 'bad_class', `forged unknown class -> ${e1?.code}`);
e1 = await raw(P1, { t: 'outfit', outfit: { outfit: 'astronaut', hat: 'none', color: 0, skin: 0 } });
check(e1?.code === 'not_owned', `forged outfit (not owned) -> ${e1?.code}`);
e1 = await raw(P1, { t: 'admin', cmd: 'wallet', args: { cid: (await SC(P1, () => window.skyCrew.net.cid)), credits: 99999 } }, 'admin_denied');
check(!!e1, `player cannot grant himself credits (${e1?.reason})`);
// Developer panel wallet tab
await SC(A, () => window.skyCrew.openPanel(true));
await A.p.waitForFunction(() => window.skyCrew.panelTabs().includes('wallet'), null, { polling: 250, timeout: 8000 }).catch(() => {});
check((await SC(A, () => window.skyCrew.panelTabs())).includes('wallet'), 'Developer panel has the Wallet tab');
await tap(A, '#admTabs [data-tab="wallet"]');
await tap(A, `[data-wallet="${u1}"] [data-credits="1000"]`);
check(await waitLook(P1, (l) => l.balance === 1000), 'Developer granted ₵1000: the player sees it live');
await shot(A, 'dev-wallet-tab');
// buy + wear in the shop UI
await SC(P1, () => window.skyCrew.openShop('outfit'));
await P1.p.waitForSelector('[data-buy="outfit:attendant"]:not([disabled])', { timeout: 8000 });
await tap(P1, '[data-buy="outfit:attendant"]');
check(await waitLook(P1, (l) => l.balance === 700 && l.owned.includes('outfit:attendant')), 'bought the attendant outfit for ₵300 (balance 700)');
await tap(P1, '[data-item="outfit:attendant"] [data-use]');
check(await waitLook(P2, (l, u) => l.remotes.some((x) => x.username === u && x.key.includes('"attendant"')), u1), 'mid-flight outfit change is synced to the co-op crew');
await shot(P1, 'shop-attendant-worn');
// class: not enough money, then buy with a second grant
await tap(P1, '#shopTabs [data-tab="class"]');
const cp = await P1.p.$eval('[data-buy="class:cabin_pro"]', (b) => b.disabled);
check(cp, 'Cabin Pro (₵1000) is not affordable with ₵700');
await tap(A, `[data-wallet="${u1}"] [data-credits="500"]`);
check(await waitLook(P1, (l) => l.balance === 1200), 'second grant arrives (₵1200)');
await P1.p.waitForSelector('[data-buy="class:cabin_pro"]:not([disabled])', { timeout: 8000 });
await tap(P1, '[data-buy="class:cabin_pro"]');
check(await waitLook(P1, (l) => l.balance === 200 && l.owned.includes('class:cabin_pro')), 'bought Cabin Pro (₵200 left)');
await tap(P1, '[data-item="class:cabin_pro"] [data-use]');
check(await waitLook(P1, (l) => l.klass === 'cabin_pro'), 'picked the Cabin Pro class (server accepted)');
check(await waitLook(P2, (l, u) => l.remotes.some((x) => x.username === u && x.klass === 'cabin_pro'), u1), 'the class badge is synced to other players');
check(await waitLook(A, (l) => l.crewClasses.includes('cabin_pro')), 'the host simulation sees the Cabin Pro perk');
await shot(P1, 'shop-classes');
await tap(P1, '#shopClose');
// HUD balance chip
L = await look(P1);
check(/₵ 200/.test(L.hud) && /Cabin Pro/.test(L.hud), `HUD shows balance + class (${L.hud})`);
// double purchase with the same purchaseId is idempotent and not charged twice
r = await api(P1.p, 'POST', '/api/game/sky-crew/shop/buy', { item: 'hat:beanie', purchaseId: `same${n}xxxx` });
const r2 = await api(P1.p, 'POST', '/api/game/sky-crew/shop/buy', { item: 'hat:beanie', purchaseId: `same${n}xxxx` });
check(r.status === 200 && r2.status === 200 && r2.j.balance === 80, `repeat purchase request charged once (balance ${r2.j?.balance})`);
// Developer removes the class -> class cleared everywhere
await tap(A, '#admTabs [data-tab="wallet"]').catch(() => {});
await A.p.selectOption(`[data-wallet-item="${u1}"]`, 'class:cabin_pro');
await tap(A, `[data-wallet="${u1}"] [data-act="take"]`);
check(await waitLook(P2, (l, u) => l.remotes.some((x) => x.username === u && !x.klass), u1), 'Developer removed the class: badge gone for everyone');
check(await waitLook(P1, (l) => !l.owned.includes('class:cabin_pro')), 'the removed class is no longer owned');
// Developer owns everything for free
L = await look(A);
check(L.ownsAll, 'Developer owns every item for free');
await SC(A, () => window.skyCrew.openPanel(false)).catch(() => {});
// audit log has the grants
const au = await api(A.p, 'GET', '/api/admin/audit?limit=100');
const acts = (au.j?.entries || au.j?.logs || au.j?.items || []).map((x) => x.action);
check(acts.includes('ingame.wallet.grant'), `grants are audit-logged (${acts.filter((a) => /wallet|shop|class|outfit/.test(a)).slice(0, 6).join(', ')})`);

console.log(`\n${report.length} passed, ${fail.length} failed`);
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
