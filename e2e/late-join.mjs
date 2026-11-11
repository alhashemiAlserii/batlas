// Sky Crew late-join e2e: a guest joining mid-boarding (airport on) lands in the terminal at the entrance step and
// can walk; a guest joining mid-flight lands inside the cabin (not on the apron / in the terminal / falling), sees
// the room's phase, is not stuck in the terminal flow, and can walk. No page errors.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(); const errs = [];
const mk = async (label, skip) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript((skip) => { localStorage.setItem('skycrew.quality', 'low'); if (skip) localStorage.setItem('skycrew.skipAirport', '1'); else localStorage.removeItem('skycrew.skipAirport'); }, skip);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`[${label}] ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply/.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  await p.goto(`${B}/login`);
  const st = await p.evaluate(async (u) => { const c = (await (await fetch('/api/csrf')).json()).csrfToken; return (await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': c }, body: JSON.stringify({ username: u, password: 'Sky-crew-test-pass-1' }) })).status; }, `e2e_lj${label}${Date.now() % 100000}`);
  if (st >= 300) throw new Error(`register ${st}`);
  await p.goto(`${B}/play/sky-crew?fps=2`); await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 }); await p.waitForSelector('#bJoin:not([disabled])');
  return p;
};
const join = async (G, code) => { await G.fill('#joinCode', code); await G.click('#bJoin'); await G.waitForFunction(() => window.skyCrew.state().room, null, { timeout: 15000 }); await G.click('#bBoard'); await G.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 30000 }); await sleep(2500); };
const walks = async (G) => { const a = await G.evaluate(() => window.skyCrew.state().me); await G.evaluate(() => window.skyCrew.look(0, 0)); await G.keyboard.down('KeyW'); await G.waitForFunction((a) => { const m = window.skyCrew.state().me; return Math.hypot(m.x - a.x, m.z - a.z) > 0.4; }, a, { timeout: 10000 }).catch(() => {}); await G.keyboard.up('KeyW'); const b = await G.evaluate(() => window.skyCrew.state().me); return Math.hypot(b.x - a.x, b.z - a.z); };

// 1) mid-boarding with the airport ON: host already walking the terminal
const H1 = await mk('h1', false);
await H1.click('#bCreate'); await H1.waitForFunction(() => window.skyCrew.state().room?.code);
const c1 = await H1.evaluate(() => window.skyCrew.state().room.code);
await H1.click('#bBoard'); await H1.waitForFunction(() => window.skyCrew.state().playing);
await sleep(1500);
const G1 = await mk('g1', true); // the guest's own skip setting must not matter: the room decides
await join(G1, c1);
let s = await G1.evaluate(() => ({ st: window.skyCrew.state(), term: window.skyCrew.term() }));
check(s.st.phase === 'boarding' && s.term.airport && s.term.active, `mid-boarding: guest sees boarding with the airport on (${s.st.phase}, airport ${s.term.airport})`);
check(s.st.me.z > 25 && !s.st.paused, `mid-boarding: guest spawns in the terminal (z ${s.st.me.z.toFixed(1)}, y ${s.st.me.y.toFixed(1)})`);
check(s.term.step !== 'boarded', `mid-boarding: guest starts the airport steps (step ${s.term.step})`);
check(await walks(G1) > 0.4, 'mid-boarding: guest can walk');
const crew = await H1.evaluate(() => window.skyCrew.term().crew.list.length);
check(crew === 2, `mid-boarding: host's crew list includes the late guest (${crew})`);

// 2) mid-flight (airport skipped by the host): host departs and cruises, then the guest joins
const H2 = await mk('h2', true);
await H2.click('#bCreate'); await H2.waitForFunction(() => window.skyCrew.state().room?.code);
const c2 = await H2.evaluate(() => window.skyCrew.state().room.code);
await H2.click('#bBoard'); await H2.waitForFunction(() => window.skyCrew.state().playing);
await H2.evaluate(() => { window.skyCrew.debug.sitAll(); window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
await H2.keyboard.down('KeyR'); await H2.waitForFunction(() => window.skyCrew.state().phase !== 'boarding', null, { timeout: 90000 }).catch(() => {}); await H2.keyboard.up('KeyR');
await H2.evaluate(() => window.skyCrew.setFlight({ y: 600, speed: 90, throttle: 0.6, onGround: false, airborneOnce: true, pitch: 0 }));
await sleep(1500);
const hp = await H2.evaluate(() => window.skyCrew.state().phase);
check(hp !== 'boarding', `mid-flight: host is flying (${hp})`);
const G2 = await mk('g2', false);
await join(G2, c2);
s = await G2.evaluate(() => ({ st: window.skyCrew.state(), term: window.skyCrew.term(), inCabin: window.skyCrew.debug.colsAt ? true : true }));
const m = s.st.me;
check(s.st.phase !== 'boarding' && s.st.phase === (await H2.evaluate(() => window.skyCrew.state().phase)), `mid-flight: guest sees the host's phase (${s.st.phase})`);
check(m.z < 13 && m.z > -16 && Math.abs(m.x) < 2.3 && Math.abs(m.y) < 0.6, `mid-flight: guest is inside the cabin (${m.x.toFixed(1)}, ${m.y.toFixed(1)}, ${m.z.toFixed(1)})`);
check(!s.term.active, 'mid-flight: no terminal flow while flying');
await sleep(2000);
const m2 = await G2.evaluate(() => window.skyCrew.state().me);
check(Math.abs(m2.y) < 0.6 && m2.z < 13, `mid-flight: still aboard 2 s later (y ${m2.y.toFixed(1)}, z ${m2.z.toFixed(1)})`);
check(await walks(G2) > 0.4, 'mid-flight: guest can walk');
check(errs.length === 0, `no page errors${errs.length ? ` ${errs.slice(0, 2)}` : ''}`);
await browser.close();
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED'); process.exit(fail.length ? 1 : 0);
