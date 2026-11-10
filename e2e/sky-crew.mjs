// Sky Crew (game revision: rear door, forward hold) browser checks: Chromium + WebKit, desktop + mobile, plus a two-client co-op room.
// Usage: node sky-crew.mjs [chromium|webkit|coop|all]
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/e2e', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const which = process.argv[2] || 'all';
const report = [];
const fail = [];
const ok = (m) => { report.push(`✔ ${m}`); console.log(`✔ ${m}`); };
const bad = (m) => { fail.push(m); console.log(`✘ ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Playwright's screenshot helper injects a <style> (blocked by our strict CSP); that is test noise, not a game error.
const NOISE = /Refused to apply a stylesheet|Refused to apply inline style|apply inline style/i;

function watch(page, label, errs) {
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push(`[${label}] pageerror ${e.message}`));
}
async function boot(page, solo = true) {
  await page.goto(`${B}/play/sky-crew`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.skyCrew?.ready, null, { timeout: 30000 });
  if (solo) { await page.click('#bSolo'); await page.waitForFunction(() => window.skyCrew.state().playing); }
}
const st = (page) => page.evaluate(() => window.skyCrew.state());

/** Pick up a passenger, throw them down the aisle, then out of the open REAR door in flight. */
async function paxChaos(page, name) {
  // depart properly (everyone seated), then jump to cruise
  await page.evaluate(() => { window.skyCrew.debug.sitAll(); window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
  await page.keyboard.down('KeyR'); await page.waitForFunction(() => window.skyCrew.state().phase !== 'boarding', null, { timeout: 90000 }).catch(() => {}); await page.keyboard.up('KeyR');
  await page.evaluate(() => { window.skyCrew.leaveSeat(); window.skyCrew.setFlight({ y: 600, speed: 90, throttle: 0.6, onGround: false, airborneOnce: true, pitch: 0 }); });
  await sleep(600);
  const near = (await page.evaluate(() => window.skyCrew.pax())).filter((x) => x.state === 'seated').sort((a, b) => a.z - b.z);
  const px = near[2];
  await page.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 1.0); window.skyCrew.lookAt(q.x, 0.7, q.z); }, px);
  await sleep(150);
  const t = await page.evaluate(() => window.skyCrew.target());
  await page.keyboard.press('KeyE'); await sleep(400);
  const held = await page.evaluate(() => window.skyCrew.heldPax());
  const all = await page.evaluate(() => window.skyCrew.pax());
  const carried = all.find((x) => x.id === held);
  const panicky = all.filter((x) => x.id !== held && x.panic).length;
  held && carried.state === 'carried' && panicky >= 1 ? ok(`${name}: picked up a passenger ("${t?.label}"); ${panicky} nearby passengers panic`) : bad(`${name}: pax pickup ${JSON.stringify({ t, held, carried, panicky })}`);
  await page.evaluate((z) => window.skyCrew.debug.cam([0.5, 1.95, z + 3.6], [0, 1.0, z + 0.3]), px.z);
  await page.evaluate(() => window.skyCrew.third(true)); await sleep(500);
  await page.screenshot({ path: `${OUT}/${name}-desktop-carry-passenger.png` });
  await page.evaluate(() => { window.skyCrew.debug.cam(null); window.skyCrew.third(false); });
  // throw down the aisle: they land, complain, walk back to their seat
  await page.evaluate(() => window.skyCrew.look(Math.PI, 0.2));
  await page.keyboard.press('KeyQ'); await sleep(200);
  const st1 = (await page.evaluate(() => window.skyCrew.pax())).find((x) => x.id === held).state;
  await page.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id).state === 'seated', held, { timeout: 40000 }).catch(() => {});
  const st2 = (await page.evaluate(() => window.skyCrew.pax())).find((x) => x.id === held).state;
  ['thrown', 'return'].includes(st1) && st2 === 'seated' ? ok(`${name}: thrown passenger (${st1}) landed in the aisle and walked back to their seat`) : bad(`${name}: throw states ${st1} -> ${st2}`);
  // open the rear door mid-flight, carry a passenger there and throw them out
  const d = await page.evaluate(() => window.skyCrew.debug.interactPoint('door_rear'));
  await page.evaluate((d) => { window.skyCrew.teleport(0, 0, d.z - 0.9); window.skyCrew.lookAt(d.x, d.y, d.z); }, d);
  await sleep(150); await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.skyCrew.state().doors.rearPassable, null, { timeout: 15000 }).catch(() => {});
  const p2 = (await page.evaluate(() => window.skyCrew.pax())).filter((x) => x.state === 'seated').sort((a, b) => a.z - b.z)[0];
  await page.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 1.0); window.skyCrew.lookAt(q.x, 0.7, q.z); }, p2);
  await sleep(150); await page.keyboard.press('KeyE'); await sleep(300);
  const h2 = await page.evaluate(() => window.skyCrew.heldPax());
  await page.evaluate((d) => { window.skyCrew.teleport(0, 0, d.z - 0.6); window.skyCrew.look(Math.PI, 0.1); }, d); // facing aft, in front of the rear doorway
  await sleep(100); await page.keyboard.press('KeyQ');
  try {
    await page.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id).state === 'lost', h2, { timeout: 8000 });
    await page.evaluate(() => window.skyCrew.debug.watchEject(true));
    await page.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id).chute, h2, { timeout: 15000 });
    await sleep(700);
    ok(`${name}: passenger thrown out of the open door in flight -> parachute, lost count ${(await page.evaluate(() => window.skyCrew.debug.score())).paxLost}`);
    await page.screenshot({ path: `${OUT}/${name}-desktop-passenger-parachute.png` });
  } catch { bad(`${name}: eject failed ${JSON.stringify((await page.evaluate(() => window.skyCrew.pax())).find((x) => x.id === h2))}`); }
  await page.evaluate(() => window.skyCrew.debug.watchEject(false));
  // close the door, land, check the payout charges the refund + fine
  await page.evaluate((d) => { window.skyCrew.teleport(0, 0, d.z - 0.9); window.skyCrew.lookAt(d.x, d.y, d.z); }, d);
  await sleep(150); await page.keyboard.press('KeyE'); await sleep(300);
  await page.evaluate(() => { window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
  await page.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x, z: d.z + 400, y: 30, yaw: 0, pitch: -0.07, bank: 0, speed: 70, throttle: 0.15, onGround: false, airborneOnce: true }); });
  try {
    await page.waitForSelector('#results:not(.hidden)', { timeout: 200000 });
    const res = (await st(page)).results;
    const fine = res.lines.find(([l]) => /parachuted/.test(l));
    fine && fine[1] < 0 && res.stars <= 2 ? ok(`${name}: payout charges "${fine[0]}" ${fine[1]} credits, rating capped at ${res.stars}★`) : bad(`${name}: payout ${JSON.stringify(res.lines)}`);
    await page.screenshot({ path: `${OUT}/${name}-desktop-payout.png` });
  } catch { bad(`${name}: no results after eject flight`); }
}

async function singlePlayer(name, type) {
  const browser = await type.launch();
  const errs = [];
  // ---------- desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); watch(page, `${name}-desktop`, errs);
  await page.goto(`${B}/games/sky-crew`, { waitUntil: 'networkidle' });
  const early = page.locator('a:has-text("Play early build")');
  (await early.count()) && (await early.getAttribute('href')) === '/play/sky-crew' && (await page.textContent('body')).includes('Upcoming') ? ok(`${name}: game page is Upcoming with "Play early build" -> /play/sky-crew`) : bad(`${name}: Play early build button missing`);
  (await page.locator('section.leaderboard h2:has-text("Leaderboard")').count()) ? ok(`${name}: Sky Crew leaderboard section on the game page`) : bad(`${name}: leaderboard section missing`);
  if (name === 'chromium') await page.screenshot({ path: `${OUT}/game-page-leaderboard.png`, fullPage: true });
  await boot(page, false);
  // menu: route list + settings overlay (quality + volume sliders)
  const routes = await page.$$eval('#routeSel option', (o) => o.map((x) => x.value));
  routes.length >= 3 && ['CRP', 'DNB', 'PNR'].every((r) => routes.includes(r)) ? ok(`${name}: ${routes.length} destinations in the menu (${routes.join(', ')})`) : bad(`${name}: routes ${routes}`);
  await page.click('#bSettings');
  await page.locator('#volMusic').fill('0.3');
  const vol = await page.evaluate(() => JSON.parse(localStorage.getItem('skycrew.audio') || '{}').music);
  const qv = await page.evaluate(() => window.skyCrew.quality());
  (await page.isVisible('#settings')) && vol === 0.3 && qv.pref === 'auto' ? ok(`${name}: settings overlay: volume saved (${vol}), quality auto -> ${qv.quality}, shadows ${qv.shadows}`) : bad(`${name}: settings ${vol} ${JSON.stringify(qv)}`);
  if (name === 'chromium') await page.screenshot({ path: `${OUT}/settings.png` });
  await page.click('#bSetClose');
  await page.waitForFunction(() => window.skyCrew.audio().ready, null, { timeout: 4000 }).catch(() => {});
  const au = await page.evaluate(() => window.skyCrew.audio());
  // headless WebKit has no audio output device, so its AudioContext can stay 'suspended' even after a real click
  au.music && (au.ready || name === 'webkit') ? ok(`${name}: WebAudio unlocked by the first click, menu music playing`) : bad(`${name}: audio ${JSON.stringify(au)}`);
  await page.click('#bSolo'); await page.waitForFunction(() => window.skyCrew.state().playing);
  ok(`${name}: game loaded, solo started`);
  await page.evaluate(() => { window.skyCrew.third(false); });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/${name}-desktop-spawn.png` });
  // move
  const p0 = (await st(page)).me;
  await page.keyboard.down('KeyW'); await page.waitForFunction((p0) => { const m = window.skyCrew.state().me; return Math.hypot(m.x - p0.x, m.z - p0.z) > 0.6; }, p0, { timeout: 8000 }).catch(() => {}); await page.keyboard.up('KeyW');
  const p1 = (await st(page)).me;
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  moved > 0.5 ? ok(`${name}: WASD movement (${moved.toFixed(2)} m)`) : bad(`${name}: player did not move (${moved})`);
  // pick up a bag from the cart
  const bag = (await page.evaluate(() => window.skyCrew.items())).find((i) => i.type === 'suitcase');
  await page.evaluate((b) => { window.skyCrew.teleport(b.x - 1.4, -2.4, b.z); window.skyCrew.lookAt(b.x, b.y, b.z); }, bag);
  await sleep(150);
  const tgt = await page.evaluate(() => window.skyCrew.target());
  await page.keyboard.press('KeyE'); await sleep(200);
  const held = (await st(page)).held;
  held ? ok(`${name}: picked up a ${held} (prompt: "${tgt?.label}")`) : bad(`${name}: pick up failed (target ${JSON.stringify(tgt)})`);
  // carry it up the cargo stairs into the hold by walking (stairs + door)
  await page.evaluate(() => { window.skyCrew.teleport(5.6, -2.4, -10.9); window.skyCrew.look(-Math.PI / 2 + Math.PI, -0.1); });
  await page.evaluate(() => window.skyCrew.look(Math.PI / 2, -0.1)); // face -x (towards the plane)
  // walk until inside (software-rendered headless browsers run the game in slow motion, so wait on position)
  await page.keyboard.down('KeyW'); await page.waitForFunction(() => window.skyCrew.state().me.x < 1.2, null, { timeout: 20000 }).catch(() => {}); await page.keyboard.up('KeyW');
  const inHold = (await st(page)).me;
  inHold.x < 1.9 && inHold.y > -0.1 ? ok(`${name}: walked up the cargo stairs into the hold (x=${inHold.x.toFixed(2)}, y=${inHold.y.toFixed(2)})`) : bad(`${name}: stairs walk ended at ${JSON.stringify(inHold)}`);
  await page.evaluate(() => window.skyCrew.look(Math.PI / 2, -0.5));
  await page.keyboard.press('KeyE'); await sleep(1500);
  const counts = (await st(page)).counts;
  counts.loaded >= 1 ? ok(`${name}: bag placed in the cargo hold (${counts.loaded}/${counts.bags})`) : bad(`${name}: bag not counted in hold ${JSON.stringify(counts)}`);
  await page.evaluate(() => { window.skyCrew.teleport(0.2, 0, 2.5); window.skyCrew.look(0, -0.05); });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/${name}-desktop-cabin.png` });
  await page.evaluate(() => { window.skyCrew.teleport(-22, -2.4, -34); window.skyCrew.lookAt(0, 0.2, -2); window.skyCrew.third(false); });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/${name}-desktop-exterior.png` });
  await page.evaluate(() => { window.skyCrew.teleport(30, -2.4, 14); window.skyCrew.lookAt(0, 0.5, -4); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/${name}-desktop-exterior-rear.png` });
  // pre-flight checklist from the co-pilot seat with real key presses (B seatbelt, N announcement)
  const cp = await page.evaluate(() => window.skyCrew.debug.interactPoint('seat_copilot'));
  await page.evaluate((d) => { window.skyCrew.teleport(0.5, 0, -13.5); window.skyCrew.lookAt(d.x, d.y, d.z); }, cp);
  await sleep(150);
  const cpT = await page.evaluate(() => window.skyCrew.target());
  await page.keyboard.press('KeyE'); await sleep(200);
  await page.keyboard.press('KeyB'); await sleep(100); await page.keyboard.press('KeyN'); await sleep(300);
  const cab = await page.evaluate(() => window.skyCrew.cabin());
  const cl = await page.evaluate(() => window.skyCrew.checklist());
  (await st(page)).me.mode === 'copilot' && cab.seatbelt && cab.announced === 1 && cl.find((c) => c.id === 'seatbelt').done && cl.find((c) => c.id === 'announce').done
    ? ok(`${name}: co-pilot seat ("${cpT?.label}"): seatbelt sign + announcement tick the pre-flight checklist`) : bad(`${name}: copilot ${JSON.stringify(cab)} ${JSON.stringify(cl)}`);
  await page.screenshot({ path: `${OUT}/${name}-desktop-copilot.png` });
  await page.keyboard.press('KeyX'); await sleep(100);
  // start a flight: captain's seat, throttle up, rotate
  await page.evaluate(() => { window.skyCrew.debug.sitAll(); window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
  // software-rendered browsers run in slow motion: hold the throttle key until the aircraft rolls
  await page.keyboard.down('KeyR'); await page.waitForFunction(() => window.skyCrew.state().flight.speed > 2, null, { timeout: 90000 }); await page.keyboard.up('KeyR');
  const ph = (await st(page)).phase;
  ph === 'taxi' ? ok(`${name}: flight started (phase ${ph}, doors auto-closed)`) : bad(`${name}: phase after throttle ${ph}`);
  await page.keyboard.down('KeyR');
  // headless software rendering runs slowly; skip most of the takeoff roll (physics still does the rest)
  await page.evaluate(() => window.skyCrew.setFlight({ speed: Math.max(window.skyCrew.state().flight.speed, 58) }));
  await page.waitForFunction(() => window.skyCrew.state().flight.speed > 66, null, { timeout: 60000 });
  await page.keyboard.up('KeyR');
  await page.keyboard.down('KeyW');
  try { await page.waitForFunction(() => !window.skyCrew.state().flight.onGround, null, { timeout: 15000 }); await sleep(2500); ok(`${name}: takeoff (alt ${(await st(page)).flight.y.toFixed(0)} m)`); } catch { bad(`${name}: no takeoff`); }
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${OUT}/${name}-desktop-cockpit.png` });
  await page.keyboard.press('KeyG'); await sleep(300);
  const gearUp = !(await page.evaluate(() => window.skyCrew.cabin().gearDown));
  await page.keyboard.press('KeyV'); await sleep(700);
  await page.screenshot({ path: `${OUT}/${name}-desktop-chase-gear-up.png` });
  await page.keyboard.press('KeyG'); await sleep(300);
  gearUp && (await page.evaluate(() => window.skyCrew.cabin().gearDown)) ? ok(`${name}: pilot raised and lowered the landing gear (G)`) : bad(`${name}: gear toggle failed`);
  // glide path indicator on a long final
  await page.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x + 40, z: d.z + 3060, y: 2.4 + 157, yaw: 0, pitch: -0.05, bank: 0, speed: 70, throttle: 0.3, onGround: false, airborneOnce: true }); });
  await sleep(400);
  const gp = await page.evaluate(() => window.skyCrew.glide());
  (await page.isVisible('#gpath')) && gp.papi === 2 ? ok(`${name}: landing guide visible on final (${gp.angle.toFixed(2)}°, PAPI ${gp.papi} white / ${4 - gp.papi} red)`) : bad(`${name}: glide ${JSON.stringify(gp)}`);
  await page.screenshot({ path: `${OUT}/${name}-desktop-chase-final.png` });
  await page.keyboard.press('KeyV'); await sleep(400);
  await page.screenshot({ path: `${OUT}/${name}-desktop-landing-guide.png` });
  // short final approach into Coral Point -> touchdown -> results screen
  await page.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x, z: d.z + 400, y: 30, yaw: 0, pitch: -0.07, bank: 0, speed: 70, throttle: 0.15, onGround: false, airborneOnce: true }); });
  try {
    await page.waitForFunction(() => window.skyCrew.state().phase === 'landed' || window.skyCrew.state().results, null, { timeout: 300000 });
    await page.waitForSelector('#results:not(.hidden)', { timeout: 200000 });
    const res = (await st(page)).results;
    const sc = await page.evaluate(() => window.skyCrew.debug.score());
    res.landedAt === 'CRP' && !res.crashed && res.lines.some(([l]) => /^Fares/.test(l)) && (await page.textContent('#resTotal')).includes('₵')
      ? ok(`${name}: landed at ${res.landedAt}; payout screen ${res.stars}★ ₵${res.payout} (${res.lines.length} lines: ${res.lines.slice(0, 3).map(([l, v]) => `${l} ${v}`).join('; ')}…)`) : bad(`${name}: landing result ${JSON.stringify(res)}`);
    void sc;
    await page.screenshot({ path: `${OUT}/${name}-desktop-results.png` });
  } catch (e) { bad(`${name}: landing/results failed ${JSON.stringify((await st(page)).flight)}`); }
  // cabin service + malfunction fix (debug hooks set up the situation; the actions use real E presses)
  await page.click('#bAgain'); await sleep(500);
  await page.evaluate(() => { window.skyCrew.debug.sitAll(); window.skyCrew.setFlight({ y: 600, speed: 90, throttle: 0.6, onGround: false, airborneOnce: true, pitch: 0 }); });
  await sleep(800);
  const paxPos = await page.evaluate(() => window.skyCrew.debug.request(0, 'water'));
  const disp = await page.evaluate(() => window.skyCrew.debug.interactPoint('disp_water'));
  await page.evaluate((d) => { window.skyCrew.teleport(d.x - 1.0, 0, d.z); window.skyCrew.lookAt(d.x, d.y, d.z); }, disp);
  await sleep(150); await page.keyboard.press('KeyE'); await sleep(200);
  const gotWater = (await st(page)).held === 'water';
  await page.evaluate((p) => { window.skyCrew.teleport(0, 0, p.z + 0.2); window.skyCrew.lookAt(p.x, 1.1, p.z); }, paxPos);
  await sleep(150); await page.keyboard.press('KeyE'); await sleep(300);
  const served = (await page.evaluate(() => window.skyCrew.debug.score())).served;
  gotWater && served === 1 ? ok(`${name}: galley water dispensed and served to a passenger`) : bad(`${name}: service failed (water=${gotWater}, served=${served})`);
  await page.evaluate(() => window.skyCrew.debug.trigger('engine_warning'));
  const panel = await page.evaluate(() => window.skyCrew.debug.interactPoint('panel'));
  await page.evaluate((d) => { window.skyCrew.teleport(d.x - 1.0, 0, d.z); window.skyCrew.lookAt(d.x, d.y, d.z); }, panel);
  await sleep(150); await page.keyboard.press('KeyE'); await sleep(200);
  const evLeft = await page.evaluate(() => window.skyCrew.debug.events());
  !evLeft.includes('engine_warning') ? ok(`${name}: engine warning fixed at the maintenance panel`) : bad(`${name}: panel fix failed ${evLeft}`);
  await page.evaluate(() => window.skyCrew.debug.trigger('turbulence'));
  await page.evaluate(() => { window.skyCrew.teleport(0.2, 0, 0); window.skyCrew.look(0, -0.1); });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/${name}-desktop-turbulence.png` });
  await paxChaos(page, name);
  // other destinations: Pine Ridge (mountains) and Dune Bay (desert) on short final, chase camera
  for (const [code, shot] of [['PNR', 'pine-ridge'], ['DNB', 'dune-bay']]) {
    if (await page.isVisible('#results')) await page.click('#bResMenu'); else { await page.click('#btnPause'); await page.click('#bQuit'); }
    await sleep(300);
    await page.selectOption('#routeSel', code); await page.click('#bSolo'); await page.waitForFunction(() => window.skyCrew.state().playing);
    await page.evaluate(() => { window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); window.skyCrew.third(true); });
    await page.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x, z: d.z + 1800, y: 2.4 + 95, yaw: 0, pitch: -0.05, bank: 0, speed: 70, throttle: 0.3, onGround: false, airborneOnce: true }); });
    await sleep(1500);
    const s2 = await st(page);
    s2.dest === code ? ok(`${name}: route ${code} selected, approach to ${(await page.evaluate(() => window.skyCrew.dest().name))}`) : bad(`${name}: route ${s2.dest}`);
    await page.screenshot({ path: `${OUT}/${name}-desktop-${shot}.png` });
  }
  await ctx.close();

  // ---------- mobile ----------
  const dev = type === webkit ? devices['iPad (gen 7)'] : devices['Pixel 7'];
  const mctx = await browser.newContext({ ...dev });
  const m = await mctx.newPage(); watch(m, `${name}-mobile`, errs);
  await boot(m, false);
  const mq = await m.evaluate(() => window.skyCrew.quality());
  mq.quality === 'medium' ? ok(`${name}: mobile auto quality = ${mq.quality} (shadows ${mq.shadows})`) : bad(`${name}: mobile quality ${JSON.stringify(mq)}`);
  await m.screenshot({ path: `${OUT}/${name}-mobile-menu.png` });
  await m.tap('#bSolo'); await m.waitForFunction(() => window.skyCrew.state().playing);
  const touchVisible = await m.isVisible('#joy');
  touchVisible ? ok(`${name}: mobile touch controls visible (${type === webkit ? 'iPad' : 'Pixel 7'})`) : bad(`${name}: touch controls missing`);
  // drive the joystick with a synthetic touch drag
  const jb = await m.locator('#joy').boundingBox();
  const q0 = (await st(m)).me;
  const cdp = { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 };
  await m.evaluate(({ x, y }) => {
    const el = document.querySelector('#joy');
    const ev = (t, dx, dy) => el.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', clientX: x + dx, clientY: y + dy, bubbles: true }));
    el.setPointerCapture = () => {};
    ev('pointerdown', 0, 0); ev('pointermove', 0, -60);
    window.__joyEnd = () => ev('pointerup', 0, -60);
  }, cdp);
  await sleep(900);
  await m.evaluate(() => window.__joyEnd());
  const q1 = (await st(m)).me;
  Math.hypot(q1.x - q0.x, q1.z - q0.z) > 0.5 ? ok(`${name}: joystick moves the player`) : bad(`${name}: joystick did not move player`);
  await m.evaluate(() => { window.skyCrew.teleport(0.3, 0, -6); window.skyCrew.look(0, -0.1); });
  await sleep(500);
  await m.screenshot({ path: `${OUT}/${name}-mobile-cabin.png` });
  // low quality preset (saved, applied on reload)
  await m.evaluate(() => localStorage.setItem('skycrew.quality', 'low'));
  await boot(m, false);
  const lq = await m.evaluate(() => window.skyCrew.quality());
  lq.quality === 'low' && !lq.shadows ? ok(`${name}: low quality preset applies after reload (no shadows)`) : bad(`${name}: low ${JSON.stringify(lq)}`);
  await m.tap('#bSolo'); await m.waitForFunction(() => window.skyCrew.state().playing);
  await m.evaluate(() => { window.skyCrew.teleport(0.3, 0, -6); window.skyCrew.look(0, -0.1); });
  await sleep(500);
  await m.screenshot({ path: `${OUT}/${name}-mobile-cabin-low.png` });
  await mctx.close();
  await browser.close();
  errs.length ? bad(`${name}: console errors:\n  ${errs.join('\n  ')}`) : ok(`${name}: no console errors`);
}

const admin_ = (p, cmd, args) => p.evaluate(({ cmd, args }) => window.skyCrew.admin(cmd, args).then((r) => r.t, (e) => `denied: ${e.message}`), { cmd, args });
async function coop() {
  const browser = await chromium.launch();
  const errs = [];
  const credTxt = fs.readFileSync(process.env.DEV_CREDS || new URL('../server/data/dev-creds.txt', import.meta.url).pathname, 'utf8');
  const devPw = credTxt.match(/password=(.*)/)[1].trim(), devUser = credTxt.match(/username=(.*)/)[1].trim();
  const mk = async (label) => { const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } }); const p = await ctx.newPage(); watch(p, label, errs); return { ctx, p }; };
  const A = await mk('coop-dev'), Bc = await mk('coop-player');
  const login = async (p, username, password, register = false) => {
    await p.goto(`${B}/login`);
    const r = await p.evaluate(async ({ username, password, register }) => {
      const csrf = (await (await fetch('/api/csrf')).json()).csrfToken;
      const res = await fetch(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(register ? { username, password } : { login: username, password }) });
      return res.status;
    }, { username, password, register });
    if (r >= 300) throw new Error(`${register ? 'register' : 'login'} ${username} -> ${r}`);
  };
  const guestName = `e2e_pilot${Date.now() % 100000}`;
  await login(A.p, devUser, devPw);
  await login(Bc.p, guestName, 'Sky-crew-test-pass-1', true);
  ok(`coop: signed in the Developer and registered ${guestName} (Player, username only)`);
  await boot(A.p, false); await A.p.selectOption('#routeSel', 'DNB'); await A.p.click('#bCreate');
  await A.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { timeout: 10000 });
  const code = (await st(A.p)).room.code;
  (await st(A.p)).lobby ? ok(`coop: room created ${code}, crew lobby open`) : bad('coop: lobby not shown');
  await boot(Bc.p, false); await Bc.p.fill('#joinCode', code); await Bc.p.click('#bJoin');
  await Bc.p.waitForFunction(() => window.skyCrew.state().room?.players.length === 2, null, { timeout: 10000 });
  // crew roles: A = pilot, B tries pilot (taken) then co-pilot
  await A.p.click('.crewpick button[data-crew="pilot"]');
  await Bc.p.waitForFunction(() => document.querySelector('.crewpick button[data-crew="pilot"]').classList.contains('taken'), null, { timeout: 5000 });
  await Bc.p.click('.crewpick button[data-crew="pilot"]'); await sleep(400);
  const takenMsg = await Bc.p.textContent('#lobRouteNote');
  await Bc.p.click('.crewpick button[data-crew="copilot"]');
  await A.p.waitForFunction(() => document.querySelector('#lobPlayers').textContent.includes('Co-pilot'), null, { timeout: 5000 });
  const crews = [await A.p.evaluate(() => window.skyCrew.myCrew()), await Bc.p.evaluate(() => window.skyCrew.myCrew())];
  crews[0] === 'pilot' && crews[1] === 'copilot' && /already/.test(takenMsg) ? ok(`coop: lobby crew picks pilot + co-pilot ("${takenMsg}" when B tried Pilot)`) : bad(`coop: crew ${crews} ${takenMsg}`);
  await A.p.screenshot({ path: `${OUT}/coop-lobby.png` });
  // host locks the room: a third (Player) cannot join
  const Cc = await mk('coop-player2'); const name3 = `e2e_crew${Date.now() % 100000}`;
  await login(Cc.p, name3, 'Sky-crew-test-pass-1', true);
  await A.p.click('#bLock'); await A.p.waitForFunction(() => window.skyCrew.state().room?.locked, null, { timeout: 5000 });
  await boot(Cc.p, false); await Cc.p.fill('#joinCode', code); await Cc.p.click('#bJoin');
  await Cc.p.waitForSelector('#menuErr:not(.hidden)', { timeout: 8000 }).catch(() => {});
  const lockErr = await Cc.p.textContent('#menuErr');
  /locked/i.test(lockErr) ? ok(`coop: host locked the room; Player join refused ("${lockErr}")`) : bad(`coop: locked join result "${lockErr}"`);
  await Cc.ctx.close();
  await A.p.click('#bLock'); await A.p.waitForFunction(() => !window.skyCrew.state().room?.locked, null, { timeout: 5000 });
  fs.writeFileSync('/tmp/e2e-coop-user2.txt', name3);
  await A.p.click('#bBoard'); await Bc.p.click('#bBoard');
  await Bc.p.waitForFunction(() => window.skyCrew.state().playing && window.skyCrew.state().dest === 'DNB', null, { timeout: 10000 }).then(() => ok('coop: host route (Dune Bay) reached the guest'), () => bad('coop: guest route mismatch'));
  await A.p.waitForFunction(() => window.skyCrew.state().remotes.length === 1, null, { timeout: 10000 });
  await Bc.p.waitForFunction(() => window.skyCrew.state().remotes.length === 1, null, { timeout: 10000 });
  const sa = await st(A.p), sb = await st(Bc.p);
  ok(`coop: both clients in room ${code}; A sees ${sa.remotes.map((r) => r.username)}, B sees ${sb.remotes.map((r) => r.username)} (ranks from server: ${sb.room.players.map((p) => `${p.username}=${p.role}`).join(', ')})`);
  sb.host === false && sa.host === true ? ok('coop: host/guest roles correct') : bad(`coop: host flags A=${sa.host} B=${sb.host}`);
  // position sync: move A, check B sees it
  await A.p.evaluate(() => window.skyCrew.teleport(0, 0, -5));
  await Bc.p.waitForFunction(() => Math.abs(window.skyCrew.state().remotes[0].z + 5) < 0.6, null, { timeout: 15000 }).catch(() => {}); // two software-rendered pages run at a few fps
  const rA = (await st(Bc.p)).remotes[0];
  Math.abs(rA.z + 5) < 0.6 ? ok('coop: positions sync (B sees A move to the cabin)') : bad(`coop: B sees A at ${JSON.stringify(rA)}`);
  // world sync: same luggage on both
  await sleep(500);
  const ia = await A.p.evaluate(() => window.skyCrew.items().length), ib = await Bc.p.evaluate(() => window.skyCrew.items().length);
  ia === ib ? ok(`coop: world snapshot synced (${ia} items on both)`) : bad(`coop: item mismatch A=${ia} B=${ib}`);
  const la = await A.p.evaluate(() => JSON.stringify(window.skyCrew.paxLooks())), lb = await Bc.p.evaluate(() => JSON.stringify(window.skyCrew.paxLooks()));
  la === lb && la.length > 50 ? ok('coop: passengers look identical on both clients (seeded appearance)') : bad('coop: passenger looks differ');
  // guest grabs a bag via the host
  const bag = (await Bc.p.evaluate(() => window.skyCrew.items())).find((i) => i.type === 'suitcase');
  await Bc.p.evaluate((b) => { window.skyCrew.teleport(b.x - 1.4, -2.4, b.z); window.skyCrew.lookAt(b.x, b.y, b.z); }, bag);
  await sleep(200); await Bc.p.keyboard.press('KeyE'); await sleep(900);
  const hostSees = await A.p.evaluate((id) => window.skyCrew.items().find((i) => i.id === id)?.heldBy, bag.id);
  hostSees && hostSees !== 'solo' ? ok('coop: guest picked up a bag; host simulation confirms who holds it') : bad(`coop: host sees heldBy=${hostSees}`);
  await Bc.p.keyboard.press('KeyE'); await sleep(600); // put it back down
  // admin overlay (Developer) -> spawn a beach ball, visible on both
  await A.p.keyboard.press('F2'); await sleep(300);
  const admOpen = await A.p.isVisible('#admin');
  admOpen ? ok('coop: F2 staff overlay opens for Developer') : bad('coop: overlay not open');
  await A.p.click('#admBody button:has-text("Beach ball")'); await sleep(1200);
  const balls = await Bc.p.evaluate(() => window.skyCrew.items().filter((i) => i.type === 'beach_ball').length);
  balls >= 1 ? ok('coop: Developer spawned a beach ball, guest sees it') : bad('coop: spawned item not seen by guest');
  await A.p.screenshot({ path: `${OUT}/coop-dev-admin-overlay.png` });
  await A.p.keyboard.press('F2');
  // player cannot open the overlay; forged admin command is denied server-side
  await Bc.p.keyboard.press('F2'); await sleep(200);
  (await Bc.p.isVisible('#admin')) ? bad('coop: Player opened staff overlay') : ok('coop: Player cannot open the staff overlay');
  // B looks at A in third person for a screenshot with the name tag
  await A.p.evaluate(() => { window.skyCrew.teleport(0, 0, -4); });
  await Bc.p.evaluate(() => { window.skyCrew.teleport(0, 0, 1); window.skyCrew.lookAt(0, 1.6, -4); });
  await sleep(900);
  await Bc.p.screenshot({ path: `${OUT}/coop-guest-sees-developer.png` });
  // co-pilot (guest) uses cockpit systems; the host simulation applies them
  const cpp = await Bc.p.evaluate(() => window.skyCrew.debug.interactPoint('seat_copilot'));
  await Bc.p.evaluate((d) => { window.skyCrew.teleport(0.5, 0, -13.5); window.skyCrew.lookAt(d.x, d.y, d.z); }, cpp);
  await sleep(200); await Bc.p.keyboard.press('KeyE'); await sleep(500);
  await Bc.p.keyboard.press('KeyB'); await sleep(200); await Bc.p.keyboard.press('KeyL'); await sleep(900);
  const hc = await A.p.evaluate(() => window.skyCrew.cabin()), gc = await Bc.p.evaluate(() => window.skyCrew.cabin());
  hc.seatbelt && !hc.lights && gc.seatbelt && !gc.lights ? ok('coop: guest co-pilot switched seatbelt sign on + cabin lights off; host and guest agree') : bad(`coop: systems host=${JSON.stringify(hc)} guest=${JSON.stringify(gc)}`);
  await Bc.p.keyboard.press('KeyL'); await sleep(300);
  await Bc.p.screenshot({ path: `${OUT}/coop-copilot-guest.png` });
  // a short flight: host pilots, both clients save their result to their profile
  await A.p.evaluate(() => window.skyCrew.debug.sitAll());
  await Bc.p.keyboard.press('KeyX'); await sleep(200);
  await A.p.evaluate(() => { window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
  await A.p.keyboard.down('KeyR'); await A.p.waitForFunction(() => window.skyCrew.state().phase !== 'boarding', null, { timeout: 90000 }).catch(() => {}); await A.p.keyboard.up('KeyR');
  await sleep(3000);
  await A.p.evaluate(() => window.skyCrew.setFlight({ y: 500, onGround: false, airborneOnce: true, pitch: 0, speed: 85 }));
  await sleep(1500);
  // guest throws a passenger out of the REAR door (host authoritative, guest predicts)
  const df = await Bc.p.evaluate(() => window.skyCrew.debug.interactPoint('door_rear'));
  await Bc.p.evaluate((d) => { window.skyCrew.teleport(0, 0, d.z - 0.9); window.skyCrew.lookAt(d.x, d.y, d.z); }, df);
  await sleep(200); await Bc.p.keyboard.press('KeyE');
  await Bc.p.waitForFunction(() => window.skyCrew.state().doors.rearPassable, null, { timeout: 15000 }).catch(() => {});
  const pB = (await Bc.p.evaluate(() => window.skyCrew.pax())).filter((x) => x.state === 'seated' && x.z > -8).sort((a, b) => a.z - b.z)[0];
  if (!pB) bad('coop: no seated passengers for the throw test');
  else {
    await Bc.p.evaluate((q) => { window.skyCrew.teleport(0, 0, q.z + 1.0); window.skyCrew.lookAt(q.x, 0.7, q.z); }, pB);
    await sleep(200); await Bc.p.keyboard.press('KeyE'); await sleep(1000);
    const hostView = (await A.p.evaluate(() => window.skyCrew.pax())).find((x) => x.id === pB.id);
    const bCid = await A.p.evaluate(() => [...window.skyCrew.state().remotes].length);
    hostView?.state === 'carried' && hostView.carriedBy && bCid ? ok('coop: guest picked up a passenger; host simulation shows them carried by the guest') : bad(`coop: host pax view ${JSON.stringify(hostView)}`);
    // throw aft through the middle of the rear doorway (door spans x -0.6..0.6 in the rear wall at z 13)
    await Bc.p.evaluate((d) => { window.skyCrew.teleport(0, 0, d.z - 0.6); window.skyCrew.look(Math.PI, 0.1); }, df);
    await sleep(150);
    const throwFrom = await Bc.p.evaluate(() => window.skyCrew.state().me);
    await Bc.p.keyboard.press('KeyQ');
    let stage = 'host sees lost';
    const diag = async () => {
      const one = async (pg) => pg.evaluate((id) => { const s = window.skyCrew.state(); const p = window.skyCrew.pax().find((x) => x.id === id); return { pax: p, phase: s.phase, flight: { y: Math.round(s.flight.y), onGround: s.flight.onGround, speed: Math.round(s.flight.speed) }, me: s.me ?? null, held: s.held, doors: s.doors }; }, pB.id).catch((e) => e.message);
      return JSON.stringify({ throwFrom, host: await one(A.p), guest: await one(Bc.p) });
    };
    try {
      await A.p.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id).state === 'lost', pB.id, { timeout: 10000 });
      stage = 'guest sees lost';
      await Bc.p.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id).state === 'lost', pB.id, { timeout: 10000 });
      ok('coop: guest threw the passenger out of the open door; both clients see them parachute (lost)');
      await Bc.p.evaluate(() => window.skyCrew.debug.watchEject(true)); await sleep(1800);
      await Bc.p.screenshot({ path: `${OUT}/coop-passenger-parachute.png` });
      await Bc.p.evaluate(() => window.skyCrew.debug.watchEject(false));
      // Developer respawns the lost passenger from the staff tools
      stage = 'respawn';
      const rr = await admin_(A.p, 'npc', { action: 'respawn' });
      await Bc.p.waitForFunction((id) => window.skyCrew.pax().find((x) => x.id === id).state === 'seated', pB.id, { timeout: 10000 });
      ok(`coop: Developer respawned the lost passenger (${rr}); guest sees them back in their seat`);
    } catch (e) { bad(`coop: eject/respawn sync failed at "${stage}": ${e.message.split('\n')[0]} ${await diag()}`); }
    await Bc.p.evaluate((d) => { window.skyCrew.teleport(0, 0, d.z - 0.9); window.skyCrew.lookAt(d.x, d.y, d.z); }, df);
    await sleep(200); await Bc.p.keyboard.press('KeyE'); await sleep(600);
  }
  await A.p.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x, z: d.z + 400, y: 30, yaw: 0, pitch: -0.07, bank: 0, speed: 70, throttle: 0.15, onGround: false, airborneOnce: true }); });
  try {
    await A.p.waitForSelector('#results:not(.hidden)', { timeout: 200000 });
    await Bc.p.waitForSelector('#results:not(.hidden)', { timeout: 20000 });
    await A.p.waitForFunction(() => window.skyCrew.lastReport(), null, { timeout: 10000 });
    await Bc.p.waitForFunction(() => window.skyCrew.lastReport(), null, { timeout: 10000 });
    const ra = await A.p.evaluate(() => window.skyCrew.state().results);
    ok(`coop: landed at ${ra.landedAt} (${ra.routeName}); results on both clients, ${ra.total} pts`);
    await A.p.screenshot({ path: `${OUT}/coop-results.png` });
    const lbd = await A.p.evaluate(async () => (await (await fetch('/api/games/sky-crew/leaderboard')).json()).leaderboard.map((x) => x.username));
    lbd.includes(devUser) && lbd.includes(guestName) ? ok(`coop: both flights saved; leaderboard lists ${lbd.join(', ')}`) : bad(`coop: leaderboard ${lbd}`);
    const prof = await A.p.evaluate(async (u) => (await (await fetch(`/api/users/${u}/game-stats`)).json()).skyCrew, guestName);
    prof.flights >= 1 ? ok(`coop: guest profile stats ${JSON.stringify(prof)}`) : bad(`coop: profile stats ${JSON.stringify(prof)}`);
    await Bc.p.goto(`${B}/u/${guestName}`, { waitUntil: 'networkidle' });
    (await Bc.p.locator('text=Sky Crew stats').count()) ? ok('coop: stats shown on the profile page') : bad('coop: profile stats section missing');
    await Bc.p.screenshot({ path: `${OUT}/profile-sky-crew-stats.png`, fullPage: true });
    await Bc.p.goto(`${B}/games/sky-crew`, { waitUntil: 'networkidle' }); await sleep(300);
    await Bc.p.screenshot({ path: `${OUT}/game-page-leaderboard.png`, fullPage: true });
    // rejoin as guest for the hand-over test
    await boot(Bc.p, false); await Bc.p.fill('#joinCode', code); await Bc.p.click('#bJoin');
    await Bc.p.waitForFunction(() => window.skyCrew.state().lobby, null, { timeout: 10000 });
    await Bc.p.click('#bBoard');
  } catch (e) { bad(`coop: flight/stats failed ${e.message}`); }
  // host hand-over: start a new flight with some state, host leaves, guest continues without a reset
  await A.p.click('#bAgain').catch(() => {}); await sleep(800);
  await Bc.p.waitForFunction(() => window.skyCrew.state().room?.players.length === 2 && window.skyCrew.state().phase === 'boarding', null, { timeout: 15000 });
  await A.p.evaluate(() => { window.skyCrew.debug.trigger('engine_warning'); });
  await sleep(1200);
  const before = await st(Bc.p);
  await A.p.evaluate(() => window.skyCrew.leaveSeat());
  await A.ctx.close();
  try {
    await Bc.p.waitForFunction(() => window.skyCrew.state().host, null, { timeout: 10000 });
    await sleep(800);
    const after = await st(Bc.p), evs = await Bc.p.evaluate(() => window.skyCrew.debug.events());
    after.seed === before.seed && after.phase === before.phase && evs.includes('engine_warning') && after.counts.bags === before.counts.bags
      ? ok(`coop: host left, guest took over the same flight (seed kept, phase ${after.phase}, engine warning still active)`) : bad(`coop: hand-over before=${JSON.stringify([before.seed, before.phase])} after=${JSON.stringify([after.seed, after.phase, evs])}`);
  } catch (e) { bad(`coop: guest never became host ${e.message}`); }
  // Developer dashboard: live room list -> join the (now locked) room hidden
  const D = await mk('dev-dashboard');
  await login(D.p, devUser, devPw);
  await Bc.p.evaluate(() => window.skyCrew.lockRoom(true));
  await sleep(500);
  await D.p.goto(`${B}/studio-console#rooms`, { waitUntil: 'networkidle' });
  try {
    await D.p.waitForSelector('#liveRooms td strong', { timeout: 10000 });
    const rowsTxt = await D.p.textContent('#liveRooms tbody');
    rowsTxt.includes(code) ? ok(`coop: Developer dashboard lists live room ${code} (${rowsTxt.includes('🔒') ? 'locked' : 'open'})`) : bad(`coop: dashboard rows "${rowsTxt}"`);
    await D.p.screenshot({ path: `${OUT}/dev-dashboard-live-rooms.png`, fullPage: true });
    await D.p.check('#joinHidden');
    await D.p.click(`#liveRooms tr:has-text("${code}") button`);
    await D.p.waitForFunction(() => window.skyCrew?.state().room?.code, null, { timeout: 15000 });
    const ds = await D.p.evaluate(() => window.skyCrew.state());
    await sleep(800);
    const bSees = await Bc.p.evaluate(() => window.skyCrew.state().room.players.map((p) => p.username));
    ds.room.hidden && ds.room.locked && !bSees.includes(devUser) ? ok(`coop: Developer joined the LOCKED room ${code} hidden from the dashboard; host's player list: ${bSees.join(', ')}`) : bad(`coop: dev join ${JSON.stringify(ds.room)} B sees ${bSees}`);
    await D.p.screenshot({ path: `${OUT}/dev-hidden-spectate.png` });
  } catch (e) { bad(`coop: dev live-room join failed ${e.message}`); }
  await D.ctx.close();
  await Bc.ctx.close(); await browser.close();
  errs.length ? bad(`coop: console errors:\n  ${errs.join('\n  ')}`) : ok('coop: no console errors');
  fs.writeFileSync('/tmp/e2e-coop-user.txt', guestName);
}

if (which === 'chromium' || which === 'all') await singlePlayer('chromium', chromium).catch((e) => bad(`chromium crashed: ${e.stack}`));
if (which === 'webkit' || which === 'all') await singlePlayer('webkit', webkit).catch((e) => bad(`webkit crashed: ${e.stack}`));
if (which === 'coop' || which === 'all') await coop().catch((e) => bad(`coop crashed: ${e.stack}`));
console.log(`\n${report.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
