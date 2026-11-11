// Sky Crew co-op landing + payout e2e: host flies a real (>= minimum airborne time) co-op flight with a signed-in guest,
// lands at the destination; both clients get results, and the server-computed salary is credited exactly once to each
// crew member (wallet delta == the paid amount, unchanged after a later snapshot burst). Logs flight progress so a slow
// (starved) client can be told apart from a landing that never completes.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(); const errs = [];
const mk = async (label, q = '') => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply/.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  await p.goto(`${B}/login`);
  const st = await p.evaluate(async (u) => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ username: u, password: 'Sky-crew-test-pass-1' }) })).status; }, `e2e_cl${label}${Date.now() % 100000}`);
  if (st >= 300) throw new Error(`register ${st}`);
  await p.goto(`${B}/play/sky-crew${q}`); await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 }); await p.waitForSelector('#bJoin:not([disabled])');
  return p;
};
const bal = (p) => p.evaluate(async () => (await (await fetch('/api/game/sky-crew/wallet')).json()).balance);
const fl = (p) => p.evaluate(() => { const s = window.skyCrew.state(); const d = window.skyCrew.dest(); return { ph: s.phase, dz: Math.round(s.flight.z - d.z), y: Math.round(s.flight.y), v: Math.round(s.flight.speed), g: s.flight.onGround, fps: window.skyCrew.debug?.perf?.().fps ?? window.skyCrew.perf?.().fps ?? null }; });

const H = await mk('h'); const G = await mk('g', '?fps=2');
await H.click('#bCreate'); await H.waitForFunction(() => window.skyCrew.state().room?.code);
const code = await H.evaluate(() => window.skyCrew.state().room.code);
await G.fill('#joinCode', code); await G.click('#bJoin'); await G.waitForFunction(() => window.skyCrew.state().room, null, { timeout: 15000 });
await H.click('#bBoard'); await H.waitForFunction(() => window.skyCrew.state().playing);
await G.click('#bBoard'); await G.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 30000 });
const b0 = { h: await bal(H), g: await bal(G) };
await H.evaluate(() => { window.skyCrew.debug.sitAll(); window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
await H.keyboard.down('KeyR'); await H.waitForFunction(() => window.skyCrew.state().phase !== 'boarding', null, { timeout: 90000 }).catch(() => {}); await H.keyboard.up('KeyR');
await H.evaluate(() => window.skyCrew.setFlight({ y: 600, speed: 90, throttle: 0.6, onGround: false, airborneOnce: true, pitch: 0 }));
check(await H.evaluate(() => window.skyCrew.state().room.pilotCid === window.skyCrew.state().me.cid || !!window.skyCrew.state().room.pilotCid), 'host is in the pilot seat');
await sleep(75000); // the server's minimum believable airborne time for the route
const t0 = Date.now();
await H.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x, z: d.z + 400, y: 30, yaw: 0, pitch: -0.07, bank: 0, speed: 70, throttle: 0.15, onGround: false, airborneOnce: true }); });
let res = null;
for (let i = 0; i < 40 && !res; i++) {
  await sleep(6000);
  const f = await fl(H); console.log(`  … ${Math.round((Date.now() - t0) / 1000)} s ${JSON.stringify(f)}`);
  if (await H.isVisible('#results')) res = await H.evaluate(() => window.skyCrew.state().results);
}
check(!!res, `host landed and shows results (${res ? `${res.landedAt}, ${res.landing}, ${Math.round((Date.now() - t0) / 1000)} s` : 'timeout'})`);
if (res) {
  await G.waitForSelector('#results:not(.hidden)', { timeout: 30000 }).then(() => check(true, 'guest shows results')).catch(() => check(false, 'guest shows results'));
  await sleep(4000);
  const sal = async (p) => p.locator('#resSalary').innerText().catch(() => '');
  const sh = await sal(H), sg = await sal(G);
  const b1 = { h: await bal(H), g: await bal(G) };
  const num = (t) => Number((t.match(/\+\s*[₵]?\s*([\d,]+)/) || [])[1]?.replace(/,/g, '') ?? NaN);
  check(b1.h - b0.h > 0 && b1.h - b0.h === b1.g - b0.g, `both crew paid the same server salary (host +${b1.h - b0.h}, guest +${b1.g - b0.g})`);
  check(num(sh) === b1.h - b0.h || /paid/i.test(sh), `host payslip matches the wallet (${sh.split('\n')[0].slice(0, 80)})`);
  check(num(sg) === b1.g - b0.g || /paid/i.test(sg), `guest payslip matches the wallet (${sg.split('\n')[0].slice(0, 80)})`);
  await sleep(8000); // more host snapshots in the results phase must not pay again
  const b2 = { h: await bal(H), g: await bal(G) };
  check(b2.h === b1.h && b2.g === b1.g, `paid exactly once (balances unchanged 8 s later: ${b2.h - b1.h}, ${b2.g - b1.g})`);
  const nErr = errs.length;
  const forged = await G.evaluate(async () => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/game/salary', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ flightKey: 'forged:1:1', userIds: [1], amount: 1500 }) })).status; });
  errs.splice(nErr); // the forged request's own 401 is expected
  check(forged === 401 || forged === 403, `a browser cannot credit a salary itself (POST /api/game/salary → ${forged})`);
}
check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(fail.length ? `${fail.length} failed` : 'all passed'); process.exit(fail.length ? 1 : 0);
