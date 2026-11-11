// Sky Crew co-op snapshot ordering e2e: host snapshots carry a host id + sequence number; a guest that receives an
// older snapshot after a newer one (delayed / reordered) must ignore it, so shared toggles (cabin lights, seatbelt
// sign, PA, doors, weather) can never be rolled back. Also a real co-pilot toggle converges on both clients.
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
  const st = await p.evaluate(async (u) => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ username: u, password: 'Sky-crew-test-pass-1' }) })).status; }, `e2e_so${label}${Date.now() % 100000}`);
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

// capture the host's real snapshots on the guest
await G.evaluate(() => { window.__w = []; window.skyCrew.net.addEventListener('world', (e) => window.__w.push(e.detail.w)); });
await G.waitForFunction(() => window.__w.length >= 2, null, { timeout: 15000 });
const meta = await G.evaluate(() => { const w = window.__w.at(-1); return { hs: w.hs, sq: w.sq, lights: w.cabin.lights }; });
check(meta.hs && Number.isFinite(meta.sq), `host snapshots carry host id + sequence (sq ${meta.sq})`);

// forced race: newer snapshot (lights OFF, belt ON) arrives, then a delayed older one (lights ON, belt OFF)
const res = await G.evaluate(() => {
  const base = window.__w.at(-1), clone = (o) => JSON.parse(JSON.stringify(o));
  const newer = clone(base); newer.sq = base.sq + 1000; newer.cabin = { ...newer.cabin, lights: false, seatbelt: true };
  const older = clone(base); older.sq = base.sq + 999; older.cabin = { ...older.cabin, lights: true, seatbelt: false };
  const net = window.skyCrew.net;
  net.onMsg({ t: 'world', w: newer }); const afterNew = window.skyCrew.cabin();
  net.onMsg({ t: 'world', w: older }); const afterOld = window.skyCrew.cabin();
  return { afterNew, afterOld };
});
check(!res.afterNew.lights && res.afterNew.seatbelt, 'newer snapshot applied (lights off, seatbelt on)');
check(!res.afterOld.lights && res.afterOld.seatbelt, `delayed older snapshot ignored: toggles not rolled back (lights ${res.afterOld.lights}, belt ${res.afterOld.seatbelt})`);

// a snapshot from a NEW host (host migration) with a low sequence is still accepted
const mig = await G.evaluate(() => { const w = JSON.parse(JSON.stringify(window.__w.at(-1))); w.hs = 'new-host'; w.sq = 1; w.cabin = { ...w.cabin, lights: true }; window.skyCrew.net.onMsg({ t: 'world', w }); return window.skyCrew.cabin().lights; });
check(mig === true, 'a new host\'s first snapshot (sq 1) is accepted');
// put the guest back on the real host's stream (its sequence is far below the injected 1000)
await G.evaluate(() => { const w = JSON.parse(JSON.stringify(window.__w.at(-1))); w.hs = 'reset'; window.skyCrew.net.onMsg({ t: 'world', w }); });

// real toggle: guest co-pilot presses B and L; host applies, both converge and stay converged
const cpp = await G.evaluate(() => window.skyCrew.debug.interactPoint('seat_copilot'));
await G.evaluate((d) => { window.skyCrew.teleport(0.5, 0, -13.5); window.skyCrew.lookAt(d.x, d.y, d.z); }, cpp);
await sleep(400); await G.keyboard.press('KeyE');
await G.waitForFunction(() => window.skyCrew.state().me.mode === 'copilot', null, { timeout: 8000 }).catch(() => {});
const h0 = await H.evaluate(() => window.skyCrew.cabin());
await G.keyboard.press('KeyB'); await sleep(300); await G.keyboard.press('KeyL');
const want = { seatbelt: !h0.seatbelt, lights: !h0.lights };
const agree = async () => { const [h, g] = await Promise.all([H, G].map((p) => p.evaluate(() => window.skyCrew.cabin()))); return h.seatbelt === want.seatbelt && h.lights === want.lights && g.seatbelt === want.seatbelt && g.lights === want.lights; };
let ok = false; for (let i = 0; i < 50 && !ok; i++) { ok = await agree(); if (!ok) await sleep(200); }
check(ok, 'real co-pilot toggles (seatbelt + lights) converge on host and guest');
await sleep(1500);
check(await agree(), 'and stay converged (no later snapshot reverts them)');
check(errs.length === 0, `no console errors${errs.length ? ` ${errs.slice(0, 2)}` : ''}`);
await browser.close();
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED'); process.exit(fail.length ? 1 : 0);
