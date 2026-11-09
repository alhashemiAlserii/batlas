// Sky Crew v0 browser checks: Chromium + WebKit, desktop + mobile, plus a two-client co-op room.
// Usage: node sky-crew.mjs [chromium|webkit|coop|all]
import { chromium, webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3000';
const OUT = '/workspace/studio/docs/screenshots/stage3';
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

async function singlePlayer(name, type) {
  const browser = await type.launch();
  const errs = [];
  // ---------- desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); watch(page, `${name}-desktop`, errs);
  await page.goto(`${B}/games/sky-crew`, { waitUntil: 'networkidle' });
  const early = page.locator('a:has-text("Play early build")');
  (await early.count()) && (await early.getAttribute('href')) === '/play/sky-crew' && (await page.textContent('body')).includes('Upcoming') ? ok(`${name}: game page is Upcoming with "Play early build" -> /play/sky-crew`) : bad(`${name}: Play early build button missing`);
  if (name === 'chromium') await page.screenshot({ path: `${OUT}/game-page-play-early-build.png` });
  await boot(page);
  ok(`${name}: game loaded, solo started`);
  // move
  const p0 = (await st(page)).me;
  await page.keyboard.down('KeyW'); await sleep(900); await page.keyboard.up('KeyW');
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
  await page.evaluate(() => { window.skyCrew.teleport(5.6, -2.4, 8); window.skyCrew.look(-Math.PI / 2 + Math.PI, -0.1); });
  await page.evaluate(() => window.skyCrew.look(Math.PI / 2, -0.1)); // face -x (towards the plane)
  await page.keyboard.down('KeyW'); await sleep(2600); await page.keyboard.up('KeyW');
  const inHold = (await st(page)).me;
  inHold.x < 1.9 && inHold.y > -0.1 ? ok(`${name}: walked up the cargo stairs into the hold (x=${inHold.x.toFixed(2)}, y=${inHold.y.toFixed(2)})`) : bad(`${name}: stairs walk ended at ${JSON.stringify(inHold)}`);
  await page.evaluate(() => window.skyCrew.look(Math.PI / 2, -0.5));
  await page.keyboard.press('KeyE'); await sleep(1500);
  const counts = (await st(page)).counts;
  counts.loaded >= 1 ? ok(`${name}: bag placed in the cargo hold (${counts.loaded}/${counts.bags})`) : bad(`${name}: bag not counted in hold ${JSON.stringify(counts)}`);
  await page.evaluate(() => { window.skyCrew.teleport(0.2, 0, 2.5); window.skyCrew.look(0, -0.05); });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/${name}-desktop-cabin.png` });
  await page.evaluate(() => { window.skyCrew.teleport(16, -2.4, -24); window.skyCrew.lookAt(0, -0.5, -1); window.skyCrew.third(false); });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/${name}-desktop-apron.png` });
  // start a flight: captain's seat, throttle up, rotate
  await page.evaluate(() => { window.skyCrew.teleport(-0.3, 0, -13.6); window.skyCrew.takeSeat(); });
  await page.keyboard.down('KeyR'); await sleep(2500); await page.keyboard.up('KeyR');
  await page.waitForFunction(() => window.skyCrew.state().flight.speed > 2, null, { timeout: 15000 });
  const ph = (await st(page)).phase;
  ph === 'taxi' ? ok(`${name}: flight started (phase ${ph}, doors auto-closed)`) : bad(`${name}: phase after throttle ${ph}`);
  await page.keyboard.down('KeyR');
  await page.waitForFunction(() => window.skyCrew.state().flight.speed > 66, null, { timeout: 40000 });
  await page.keyboard.up('KeyR');
  await page.keyboard.down('KeyW');
  try { await page.waitForFunction(() => !window.skyCrew.state().flight.onGround, null, { timeout: 15000 }); await sleep(2500); ok(`${name}: takeoff (alt ${(await st(page)).flight.y.toFixed(0)} m)`); } catch { bad(`${name}: no takeoff`); }
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${OUT}/${name}-desktop-cockpit.png` });
  await page.keyboard.press('KeyV'); await sleep(500);
  await page.screenshot({ path: `${OUT}/${name}-desktop-chase.png` });
  // short final approach into Coral Point -> touchdown -> results screen
  await page.evaluate(() => { const d = window.skyCrew.dest(); window.skyCrew.setFlight({ x: d.x, z: d.z + 400, y: 30, yaw: 0, pitch: -0.07, bank: 0, speed: 70, throttle: 0.15, onGround: false, airborneOnce: true }); });
  try {
    await page.waitForFunction(() => window.skyCrew.state().phase === 'landed' || window.skyCrew.state().results, null, { timeout: 60000 });
    await page.waitForSelector('#results:not(.hidden)', { timeout: 90000 });
    const res = (await st(page)).results;
    ok(`${name}: landed at ${res.landedAt ?? 'off-runway'}${res.crashed ? ' (crash)' : ''}, results screen ${res.stars}★ total ${res.total}`);
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
  await ctx.close();

  // ---------- mobile ----------
  const dev = type === webkit ? devices['iPad (gen 7)'] : devices['Pixel 7'];
  const mctx = await browser.newContext({ ...dev });
  const m = await mctx.newPage(); watch(m, `${name}-mobile`, errs);
  await boot(m, false);
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
  await mctx.close();
  await browser.close();
  errs.length ? bad(`${name}: console errors:\n  ${errs.join('\n  ')}`) : ok(`${name}: no console errors`);
}

async function coop() {
  const browser = await chromium.launch();
  const errs = [];
  const devPw = fs.readFileSync('/workspace/studio/server/data/test-developer-credentials.txt', 'utf8').match(/password=(.*)/)[1].trim();
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
  await login(A.p, 'test_dev', devPw);
  await login(Bc.p, guestName, 'Sky-crew-test-pass-1', true);
  ok(`coop: signed in test_dev (Developer) and registered ${guestName} (Player, username only)`);
  await boot(A.p, false); await A.p.click('#bCreate');
  await A.p.waitForFunction(() => window.skyCrew.state().room?.code, null, { timeout: 10000 });
  const code = (await st(A.p)).room.code;
  ok(`coop: room created ${code}`);
  await boot(Bc.p, false); await Bc.p.fill('#joinCode', code); await Bc.p.click('#bJoin');
  await Bc.p.waitForFunction(() => window.skyCrew.state().room?.players.length === 2, null, { timeout: 10000 });
  await A.p.waitForFunction(() => window.skyCrew.state().remotes.length === 1, null, { timeout: 10000 });
  await Bc.p.waitForFunction(() => window.skyCrew.state().remotes.length === 1, null, { timeout: 10000 });
  const sa = await st(A.p), sb = await st(Bc.p);
  ok(`coop: both clients in room ${code}; A sees ${sa.remotes.map((r) => r.username)}, B sees ${sb.remotes.map((r) => r.username)} (ranks from server: ${sb.room.players.map((p) => `${p.username}=${p.role}`).join(', ')})`);
  sb.host === false && sa.host === true ? ok('coop: host/guest roles correct') : bad(`coop: host flags A=${sa.host} B=${sb.host}`);
  // position sync: move A, check B sees it
  await A.p.evaluate(() => window.skyCrew.teleport(0, 0, -5));
  await sleep(800);
  const rA = (await st(Bc.p)).remotes[0];
  Math.abs(rA.z + 5) < 0.6 ? ok('coop: positions sync (B sees A move to the cabin)') : bad(`coop: B sees A at ${JSON.stringify(rA)}`);
  // world sync: same luggage on both
  await sleep(500);
  const ia = await A.p.evaluate(() => window.skyCrew.items().length), ib = await Bc.p.evaluate(() => window.skyCrew.items().length);
  ia === ib ? ok(`coop: world snapshot synced (${ia} items on both)`) : bad(`coop: item mismatch A=${ia} B=${ib}`);
  // guest grabs a bag via the host
  const bag = (await Bc.p.evaluate(() => window.skyCrew.items())).find((i) => i.type === 'suitcase');
  await Bc.p.evaluate((b) => { window.skyCrew.teleport(b.x - 1.4, -2.4, b.z); window.skyCrew.lookAt(b.x, b.y, b.z); }, bag);
  await sleep(200); await Bc.p.keyboard.press('KeyE'); await sleep(900);
  const hostSees = await A.p.evaluate((id) => window.skyCrew.items().find((i) => i.id === id)?.heldBy, bag.id);
  hostSees && hostSees !== 'solo' ? ok('coop: guest picked up a bag; host simulation confirms who holds it') : bad(`coop: host sees heldBy=${hostSees}`);
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
  await A.ctx.close(); await Bc.ctx.close(); await browser.close();
  errs.length ? bad(`coop: console errors:\n  ${errs.join('\n  ')}`) : ok('coop: no console errors');
  fs.writeFileSync('/tmp/e2e-coop-user.txt', guestName);
}

if (which === 'chromium' || which === 'all') await singlePlayer('chromium', chromium).catch((e) => bad(`chromium crashed: ${e.stack}`));
if (which === 'webkit' || which === 'all') await singlePlayer('webkit', webkit).catch((e) => bad(`webkit crashed: ${e.stack}`));
if (which === 'coop' || which === 'all') await coop().catch((e) => bad(`coop crashed: ${e.stack}`));
console.log(`\n${report.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
