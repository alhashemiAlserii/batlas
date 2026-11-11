// Sky Crew collision e2e: being put inside something solid (Developer teleport onto a seat, a teleport-gun spot by
// the windows, a passenger's seat) never leaves the player standing on the seat backs or the overhead bins; normal
// walking, the cargo stairs and jumping onto a seat still work. Chromium + WebKit.
import { chromium, webkit } from 'playwright';
const B = process.env.BASE || 'http://localhost:3200';
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await type.launch(); const ctx = await b.newContext({ viewport: { width: 900, height: 560 } });
  await ctx.addInitScript(() => { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Refused to apply/.test(m.text())) errs.push(m.text()); });
  await p.goto(`${B}/play/sky-crew?fps=2`); await p.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 });
  await p.click('#bSolo'); await p.waitForFunction(() => window.skyCrew.state().playing);
  const settle = async (pred, ms = 6000) => { await p.waitForFunction(pred, null, { polling: 100, timeout: ms }).catch(() => {}); return p.evaluate(() => window.skyCrew.state().me); };
  // every passenger seat spot (rows on both sides of the aisle)
  await p.evaluate(() => window.skyCrew.debug.sitAll()); await sleep(300);
  const seats = await p.evaluate(() => window.skyCrew.pax().filter((x) => x.state === 'seated').map((x) => ({ x: x.x, z: x.z })));
  check(seats.length >= 10, `${name}: ${seats.length} seated passengers to test against`);
  let worst = null;
  for (const s of seats.filter((_, i) => i % 2 === 0)) {
    await p.evaluate((s) => window.skyCrew.teleport(s.x, 0, s.z), s);
    const me = await settle(() => { const m = window.skyCrew.state().me; return m.onGround && window.skyCrew.debug.colsAt(m.x, m.y, m.z).length === 0; });
    const embedded = await p.evaluate((m) => window.skyCrew.debug.colsAt(m.x, m.y, m.z).length, me);
    if (me.y > 0.6 || embedded || Math.abs(me.x) > 2.3) { worst = { s, me, embedded }; break; }
  }
  check(!worst, `${name}: teleport onto ${Math.ceil(seats.length / 2)} seat spots -> on the floor or a cushion, never on seat backs/bins${worst ? ` ${JSON.stringify(worst)}` : ''}`);
  // into the sidewall under the bins
  await p.evaluate(() => window.skyCrew.teleport(-1.9, 0, 2.3));
  let me = await settle(() => window.skyCrew.state().me.onGround);
  check(me.y < 0.6 && Math.abs(me.x) < 2.3, `${name}: teleport into the window wall -> back in the cabin on the floor (${me.x.toFixed(2)}, ${me.y.toFixed(2)})`);
  // walking the aisle stays on the floor
  await p.evaluate(() => { window.skyCrew.teleport(0, 0, 4); window.skyCrew.look(0, 0); }); await sleep(300);
  await p.keyboard.down('KeyW'); await p.waitForFunction(() => window.skyCrew.state().me.z < 1, null, { timeout: 20000 }).catch(() => {}); await p.keyboard.up('KeyW');
  me = await p.evaluate(() => window.skyCrew.state().me);
  check(me.z < 1 && Math.abs(me.y) < 0.05, `${name}: walk down the aisle on the floor (z ${me.z.toFixed(2)}, y ${me.y.toFixed(2)})`);
  // jump from the aisle onto a seat cushion still works (you can climb on seats, just not get teleported onto bins)
  const s0 = seats.find((s) => s.x > 0.8) || seats[0];
  await p.evaluate((s) => { window.skyCrew.teleport(0.2, 0, s.z); window.skyCrew.lookAt(s.x, 0.5, s.z); }, s0); await sleep(300);
  await p.keyboard.down('Space'); await p.keyboard.down('KeyW'); await sleep(250); await p.keyboard.up('Space');
  await p.waitForFunction((x) => window.skyCrew.state().me.x > x - 0.25, s0.x, { timeout: 8000 }).catch(() => {}); await p.keyboard.up('KeyW');
  me = await settle(() => window.skyCrew.state().me.onGround);
  check(me.y >= 0 && me.y < 1.3, `${name}: jump towards a seat: lands on the cushion/floor, not above (y ${me.y.toFixed(2)})`);
  // cargo stairs walk-up still works
  await p.evaluate(() => { window.skyCrew.teleport(5.6, -2.4, -10.9); window.skyCrew.look(Math.PI / 2, -0.1); }); await sleep(300);
  await p.keyboard.down('KeyW'); await p.waitForFunction(() => window.skyCrew.state().me.x < 1.2, null, { timeout: 30000 }).catch(() => {}); await p.keyboard.up('KeyW');
  me = await p.evaluate(() => window.skyCrew.state().me);
  check(me.x < 1.9 && me.y > -0.1, `${name}: cargo stairs walk-up still works (x ${me.x.toFixed(2)}, y ${me.y.toFixed(2)})`);
  check(errs.length === 0, `${name}: no console errors${errs.length ? ` ${errs.slice(0, 2)}` : ''}`);
  await b.close();
}
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASSED'); process.exit(fail.length ? 1 : 0);
