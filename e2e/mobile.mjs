// Sky Crew phone/tablet e2e (WebKit): landscape phones 844x390 + 932x430, iPad landscape + portrait, phone portrait
// rotate hint; airport terminal in view, passengers walking through it, HUD/touch controls on screen and not
// overlapping, frame rate sample (software GL here, so the FPS is a floor, not the real device number).
import { webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/mobile', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const report = [], fail = [], notes = [];
const check = (c, m) => { (c ? report : fail).push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Refused to apply a stylesheet|Refused to apply inline style|apply inline style/i;
const errs = [];
const browser = await webkit.launch();
const PH = devices['iPhone 15'].userAgent, PAD = devices['iPad Pro 11'].userAgent;
const SIZES = [
  { name: 'iphone-844x390', vp: [844, 390], ua: PH, phone: true },
  { name: 'iphone-932x430', vp: [932, 430], ua: PH, phone: true },
  { name: 'ipad-landscape-1180x820', vp: [1180, 820], ua: PAD },
  { name: 'ipad-portrait-820x1180', vp: [820, 1180], ua: PAD },
  { name: 'iphone-portrait-390x844', vp: [390, 844], ua: PH, phone: true, portrait: true },
];
const SC = (p, fn, arg) => p.evaluate(fn, arg);
const rect = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; }, sel);
const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const inside = (r, w, h) => r && r.l >= -0.5 && r.t >= -0.5 && r.r <= w + 0.5 && r.b <= h + 0.5;
for (const S of SIZES) {
  const [w, h] = S.vp;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, userAgent: S.ua, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.removeItem('skycrew.skipAirport'); localStorage.removeItem('skycrew.controls.v1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${S.name}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${S.name}] pageerror ${e.message}`));
  await p.goto(`${B}/play/sky-crew`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
  const hint = await p.isVisible('#rotateHint');
  if (S.portrait) { check(hint, `${S.name}: phone portrait shows the "turn your phone sideways" hint`); await p.screenshot({ path: `${OUT}/${S.name}-rotate-hint.png` }); await ctx.close(); continue; }
  check(!hint, `${S.name}: no rotate hint (${S.phone ? 'landscape phone' : 'tablet stays usable in any orientation'})`);
  const menu = await rect(p, '#menu .card');
  check(inside(menu, w, h), `${S.name}: main menu card fits the screen`);
  await p.screenshot({ path: `${OUT}/${S.name}-menu.png` });
  await p.$eval('#bSolo', (b) => b.click());
  await p.waitForFunction(() => window.skyCrew.state().playing, null, { polling: 250, timeout: 20000 });
  await sleep(1500);
  const T = await SC(p, () => window.skyCrew.term());
  check(T.airport && T.active && T.step === 'none', `${S.name}: solo starts in the airport terminal (step ${T.step})`);
  await p.screenshot({ path: `${OUT}/${S.name}-terminal-entrance.png` });
  // HUD + touch controls on screen and not overlapping each other
  const R = {}; for (const s of ['#obj', '#joy', '#tbtns', '#btnPause', '#docs', '#toasts']) R[s] = await rect(p, s);
  check(['#obj', '#joy', '#tbtns', '#btnPause'].every((s) => inside(R[s], w, h)), `${S.name}: objectives, joystick, buttons and pause are on screen`);
  check(!overlap(R['#obj'], R['#joy']) && !overlap(R['#obj'], R['#tbtns']) && !overlap(R['#joy'], R['#tbtns']) && !overlap(R['#btnPause'], R['#obj']), `${S.name}: HUD panels and touch controls don't overlap`);
  // passengers queue at the entrance and walk through the terminal (check-in -> security -> gate)
  const z0 = Math.min(...(await SC(p, () => window.skyCrew.debug.pax())).map((q) => q.z));
  let moved = 0, P = [];
  for (let i = 0; i < 40 && moved < 1.5; i++) { await sleep(500); P = await SC(p, () => window.skyCrew.debug.pax()); moved = z0 - Math.min(...P.map((q) => q.z)); }
  check(moved >= 1.5 && P.some((q) => q.state === 'walk' && q.y < -1), `${S.name}: passengers walk from the queue into the terminal (lead moved ${moved.toFixed(1)} m, ${P.filter((q) => q.y < -1).length} in the terminal)`);
  // security + gate views (and one looking back at the passenger queue)
  await SC(p, () => window.skyCrew.debug.setPos(0.5, -2.4 + 0.9, 55.5, Math.PI));
  await sleep(900); await p.screenshot({ path: `${OUT}/${S.name}-terminal-queue.png` });
  await SC(p, () => window.skyCrew.debug.setPos(-1.2, -2.4 + 0.9, 49.5, 0.3));
  await sleep(900); await p.screenshot({ path: `${OUT}/${S.name}-terminal-security.png` });
  await SC(p, () => window.skyCrew.debug.setPos(1.5, -2.4 + 0.9, 34, 0));
  await sleep(900); await p.screenshot({ path: `${OUT}/${S.name}-terminal-gate.png` });
  // frame rate sample at the default (auto) quality
  await sleep(3000);
  const perf = await SC(p, () => window.skyCrew.debug.perf());
  notes.push(`${S.name}: ${perf.fps} fps (software GL), quality ${perf.quality}, ${perf.calls} draw calls, ${perf.triangles} tris`);
  check(perf.fps > 0 && perf.calls < 400, `${S.name}: renders (${perf.fps} fps on software GL, ${perf.calls} draw calls, quality ${perf.quality})`);
  await ctx.close();
}
console.log(`\n${report.length} passed, ${fail.length} failed`);
console.log(notes.join('\n'));
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
