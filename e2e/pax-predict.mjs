// Sky Crew guest prediction e2e: a guest's predicted passenger pickup always reconciles with the host. Refused (the
// request never reaches the host) + slow host snapshots: the guest visibly drops the passenger within a couple of
// seconds (not after N snapshots) and is told; delayed but accepted: both end up agreeing the guest carries them.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(); const errs = [];
const mk = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply/.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  await p.goto(`${B}/login`);
  const st = await p.evaluate(async (u) => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ username: u, pin: '123456' }) })).status; }, `e2e_pp${label}${Date.now() % 100000}`);
  if (st >= 300) throw new Error(`register ${st}`);
  await p.goto(`${B}/play/sky-crew?fps=2`); await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 }); await p.waitForSelector('#bJoin:not([disabled])');
  return p;
};
const H = await mk('h'), G = await mk('g');
await H.click('#bCreate'); await H.waitForFunction(() => window.skyCrew.state().room?.code);
const code = await H.evaluate(() => window.skyCrew.state().room.code);
await G.fill('#joinCode', code); await G.click('#bJoin'); await G.waitForFunction(() => window.skyCrew.state().room);
await H.click('#bBoard'); await G.click('#bBoard');
await G.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().remotes.length === 1, null, { timeout: 30000 });
await H.evaluate(() => window.skyCrew.debug.sitAll());
// guest passengers glide to the host's positions: wait until both agree (every passenger seated in the cabin)
const inCabin = () => window.skyCrew.pax().filter((x) => x.state === 'seated' && Math.abs(x.y) < 0.2 && x.z < 12).length;
await H.waitForFunction(inCabin, null, { timeout: 15000 });
const nH = await H.evaluate(inCabin);
await G.waitForFunction((n) => window.skyCrew.pax().filter((x) => x.state === 'seated' && Math.abs(x.y) < 0.2 && x.z < 12).length >= n, nH, { timeout: 20000 });
// guest network hooks: drop / delay its grab requests, throttle host snapshots
await G.evaluate(() => {
  const net = window.skyCrew.net, send = net.send.bind(net), on = net.onMsg.bind(net);
  window.__mode = 'normal'; window.__lastW = 0;
  net.send = (m) => { if (m?.t === 'act' && m.a?.k === 'grabPax') { if (window.__mode === 'refuse') return; if (window.__mode === 'delay') { setTimeout(() => send(m), 1200); return; } } send(m); };
  net.onMsg = (m) => { if (m?.t === 'world' && window.__slow) { const now = performance.now(); if (now - window.__lastW < 1000) return; window.__lastW = now; } on(m); };
  window.__toasts = []; new MutationObserver(() => { const t = document.querySelector('#toasts, #toast')?.textContent || document.body.innerText; if (/wriggled free/.test(t)) window.__toasts.push('wriggle'); }).observe(document.body, { subtree: true, childList: true, characterData: true });
});
const pick = async (q) => {
  let t = null;
  for (let i = 0; i < 40 && t?.kind !== 'grabPax'; i++) { // re-place each try: a late spawn on a slow page can move us
    if (i % 5 === 0) await G.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 1.0); window.skyCrew.lookAt(q.x, 0.7, q.z); }, q);
    await sleep(150); t = await G.evaluate(() => window.skyCrew.target());
  }
  // direct interact (same code path as E / the touch button) so the test does not depend on synthetic key delivery
  if (t?.kind === 'grabPax') await G.evaluate(() => window.skyCrew.useE());
  return t?.kind;
};
const seated = async () => {
  const hs = (await H.evaluate(() => window.skyCrew.pax())).filter((x) => x.state === 'seated' && Math.abs(x.x) < 1.2 && Math.abs(x.y) < 0.05 && x.z < 12).sort((a, b) => a.z - b.z);
  for (const q of hs.slice(0, 6)) await G.waitForFunction((q) => { const g = window.skyCrew.pax().find((x) => x.id === q.id); return g && Math.hypot(g.x - q.x, g.y - q.y, g.z - q.z) < 0.05; }, q, { timeout: 20000 }).catch(() => {});
  return hs;
};
const view = (p, id) => p.evaluate((id) => window.skyCrew.pax().find((x) => x.id === id), id);

// 1) refused + slow host: prediction shows, then visibly drops within ~2.5 s, with a message; host never carried
await G.evaluate(() => { window.__mode = 'refuse'; window.__slow = true; });
let q = (await seated())[2];
await G.evaluate((id) => { window.__seen = []; setInterval(() => { const p = window.skyCrew.pax().find((x) => x.id === id); const t = `${p.state}@${Math.round(performance.now())}`; if (!window.__seen.length || !window.__seen.at(-1).startsWith(p.state)) window.__seen.push(t); }, 20); }, q.id);
const k1 = await pick(q); check(k1 === 'grabPax', `refused: guest aimed at a passenger (${k1}; me ${JSON.stringify(await G.evaluate(() => ({ ...window.skyCrew.state().me, held: window.skyCrew.heldPax(), term: window.skyCrew.term().step, tgt: window.skyCrew.target() })))})`);
await sleep(300); const seen = await G.evaluate(() => window.__seen); const pred = seen.some((x) => x.startsWith('carried'));
check(pred, `refused: guest predicts the pickup (shows them carried before the host answers) [${seen.join(' ')}]`);
const t0 = Date.now(); let v;
for (let i = 0; i < 60; i++) { v = await view(G, q.id); if (v.state !== 'carried') break; await sleep(100); }
const ms = Date.now() - t0;
check(v.state !== 'carried' && !(await G.evaluate(() => window.skyCrew.heldPax())), `refused: guest drops the passenger again after ${ms} ms (state ${v.state})`);
check(ms < 3500, `refused: reconciled by real time, not after 6 slow snapshots (${ms} ms < 3500)`);
check((await view(H, q.id)).state !== 'carried', 'refused: host never had them carried');
check(await G.evaluate(() => window.__toasts.length > 0), 'refused: guest is told ("wriggled free")');
// nothing stuck: the guest can pick the same passenger up for real afterwards
await G.evaluate(() => { window.__mode = 'normal'; window.__slow = false; });
await sleep(1500);
const k2 = await pick(q); check(k2 === 'grabPax', `after refusal: same passenger can be targeted again (${k2}; ${JSON.stringify(await view(G, q.id))?.slice(0, 120)})`);
let both = false; for (let i = 0; i < 40 && !both; i++) { const [h, g] = await Promise.all([view(H, q.id), view(G, q.id)]); both = h.state === 'carried' && g.state === 'carried' && !!h.carriedBy && h.carriedBy === g.carriedBy; if (!both) await sleep(200); }
check(both, 'after refusal: a real pickup works and host + guest agree');
await G.evaluate(() => window.skyCrew.useE()); await sleep(1500); // put them down

// 2) delayed (1.2 s) but accepted: both end up agreeing the guest carries them, no false "wriggled free"
await G.evaluate(() => { window.__mode = 'delay'; window.__toasts = []; });
q = (await seated())[4];
check(await pick(q) === 'grabPax', 'delayed: guest aimed at a passenger');
both = false; for (let i = 0; i < 50 && !both; i++) { const [h, g] = await Promise.all([view(H, q.id), view(G, q.id)]); both = h.state === 'carried' && g.state === 'carried' && h.carriedBy === g.carriedBy; if (!both) await sleep(200); }
check(both, 'delayed: host accepts the late request; host and guest agree the guest carries them');
await sleep(1500);
const [h2, g2] = await Promise.all([view(H, q.id), view(G, q.id)]);
check(h2.state === g2.state, `delayed: still agree afterwards (${h2.state}/${g2.state})`);
check(errs.length === 0, `no console errors${errs.length ? ` ${errs.slice(0, 2)}` : ''}`);
await browser.close();
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED'); process.exit(fail.length ? 1 : 0);
