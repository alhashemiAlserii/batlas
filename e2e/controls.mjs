// Sky Crew touch control layout editor e2e (WebKit): Settings -> Edit controls, drag + resize + opacity,
// stays inside the screen, no gameplay while editing, saved per orientation, survives reload, Reset to default.
// Usage: node controls.mjs   (BASE=http://localhost:3200)
import { webkit, devices } from 'playwright';
import fs from 'node:fs';
const B = process.env.BASE || 'http://localhost:3200';
const OUT = new URL('../docs/screenshots/revision/controls', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const report = [], fail = [];
const check = (c, m) => { (c ? report : fail).push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Refused to apply a stylesheet|Refused to apply inline style|apply inline style/i;
const errs = [];
const browser = await webkit.launch();
const iphone = devices['iPhone 15'];
const SIZES = [
  { name: 'iphone-844x390', viewport: { width: 844, height: 390 }, ua: iphone.userAgent, scale: 3 },
  { name: 'iphone-932x430', viewport: { width: 932, height: 430 }, ua: iphone.userAgent, scale: 3 },
  { name: 'ipad-1180x820', viewport: { width: 1180, height: 820 }, ua: devices['iPad Pro 11'].userAgent, scale: 2 },
];
const SC = (p, fn, arg) => p.evaluate(fn, arg);
const dbg = (p) => SC(p, () => window.skyCrew.controls());
const center = (r) => ({ x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 });
const inside = (r, vw, vh) => r.l >= 0 && r.t >= 0 && r.r <= vw + 0.5 && r.b <= vh + 0.5;
async function drag(p, from, to) { // a real touch-like drag through the mouse pipeline (pointer events)
  await p.mouse.move(from.x, from.y); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8); await sleep(30); } await p.mouse.up();
}

for (const S of SIZES) {
  const ctx = await browser.newContext({ viewport: S.viewport, userAgent: S.ua, deviceScaleFactor: S.scale, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${S.name}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${S.name}] pageerror ${e.message}`));
  const { width: vw, height: vh } = S.viewport;
  await p.goto(`${B}/play/sky-crew?fps=4`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
  // into a solo game, then pause -> settings
  await p.$eval('#bSolo', (b) => b.click());
  await p.waitForFunction(() => window.skyCrew.state().playing, null, { polling: 250, timeout: 20000 }).catch(() => {});
  await sleep(800);
  await p.$eval('#btnPause', (b) => b.click());
  await p.$eval('#bSettingsP', (b) => b.click());
  check(await p.isVisible('#bEditCtl'), `${S.name}: Settings shows "Edit controls" on a touch device`);
  await p.screenshot({ path: `${OUT}/${S.name}-settings.png` });
  await p.tap('#bEditCtl');
  await sleep(300);
  let d = await dbg(p);
  check(d.editing && await p.isVisible('#ctlBar'), `${S.name}: editor opens with its toolbar`);
  const ids = Object.keys(d.rects).filter((k) => d.rects[k]);
  check(['joy', 'tE', 'tJ', 'tRun', 'tV', 'btnPause'].every((k) => ids.includes(k)), `${S.name}: editable controls shown (${ids.join(', ')})`);
  check(ids.every((k) => inside(d.rects[k], vw, vh)), `${S.name}: every control starts inside the screen`);
  await p.screenshot({ path: `${OUT}/${S.name}-editor.png` });
  // drag the jump button to the middle-left; the game must not jump/act
  const st0 = await SC(p, () => window.skyCrew.state());
  const j0 = center(d.rects.tJ);
  const tgt = { x: Math.round(vw * 0.3), y: Math.round(vh * 0.55) };
  await drag(p, j0, tgt);
  d = await dbg(p);
  const j1 = center(d.rects.tJ);
  check(Math.abs(j1.x - tgt.x) < 6 && Math.abs(j1.y - tgt.y) < 6, `${S.name}: dragged Jump to (${j1.x.toFixed(0)}, ${j1.y.toFixed(0)}) ~ (${tgt.x}, ${tgt.y})`);
  check(d.sel === 'tJ', `${S.name}: the dragged control is selected`);
  // other controls did not move when Jump left the grid
  const e0 = d.layout.items.tE; const eR = center(d.rects.tE);
  check(Math.abs(eR.x - e0.x * vw) < 3 && Math.abs(eR.y - e0.y * vh) < 3, `${S.name}: Interact stayed put while Jump moved`);
  // size L, then drag it far past the corner -> clamped inside
  await p.tap('#ctlSizeL'); await sleep(100);
  d = await dbg(p);
  const wL = d.rects.tJ.r - d.rects.tJ.l;
  check(d.layout.items.tJ.s === 1.3 && wL > 60, `${S.name}: size L applied (${wL.toFixed(0)} px wide)`);
  await drag(p, center(d.rects.tJ), { x: vw - 2, y: vh - 2 });
  d = await dbg(p);
  check(inside(d.rects.tJ, vw, vh), `${S.name}: dragging past the corner keeps Jump on screen (${JSON.stringify(d.rects.tJ)})`);
  await drag(p, center(d.rects.tJ), { x: vw * 0.3, y: vh * 0.55 });
  // move the joystick too, small size
  d = await dbg(p);
  await drag(p, center(d.rects.joy), { x: vw * 0.2, y: vh * 0.6 });
  await p.tap('#ctlSizeS'); await sleep(100);
  // opacity
  await p.$eval('#ctlOpacity', (el) => { el.value = '0.6'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  d = await dbg(p);
  check(Math.abs(+d.rects.tE.op - 0.6) < 0.01, `${S.name}: opacity 60% applied to the controls`);
  const st1 = await SC(p, () => window.skyCrew.state());
  check(Math.abs(st1.me.y - st0.me.y) < 0.05 && Math.abs(st1.me.x - st0.me.x) < 0.05 && Math.abs(st1.me.z - st0.me.z) < 0.05, `${S.name}: no gameplay while editing (player did not move or jump)`);
  await p.screenshot({ path: `${OUT}/${S.name}-edited.png` });
  await p.tap('#ctlDone'); await sleep(300);
  check(!(await dbg(p)).editing && await p.isVisible('#settings'), `${S.name}: Done returns to Settings`);
  const saved = (await dbg(p)).layout;
  // reload -> same layout
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
  await p.$eval('#bSolo', (b) => b.click());
  await p.waitForFunction(() => window.skyCrew.state().playing, null, { polling: 250, timeout: 20000 }).catch(() => {});
  await sleep(1200);
  d = await dbg(p);
  const jr = center(d.rects.tJ);
  check(d.layout && Math.abs(jr.x - saved.items.tJ.x * vw) < 3 && Math.abs(jr.y - saved.items.tJ.y * vh) < 3 && d.layout.items.tJ.s === 1.3 && d.layout.items.joy.s === 0.8, `${S.name}: layout survives a reload`);
  await p.screenshot({ path: `${OUT}/${S.name}-after-reload.png` });
  // the moved jump button still works in play
  await p.evaluate(() => { const b = document.getElementById('tJ'); const r = b.getBoundingClientRect(); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); });
  const y0 = (await SC(p, () => window.skyCrew.state())).me.y; let yMax = y0;
  for (let i = 0; i < 12; i++) { await sleep(120); yMax = Math.max(yMax, (await SC(p, () => window.skyCrew.state())).me.y); }
  const yUp = { y: yMax - y0 };
  await p.evaluate(() => { document.getElementById('tJ').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch' })); });
  check(yUp.y > 0.1, `${S.name}: moved Jump button still works in play (jumped ${yUp.y.toFixed(2)} m)`);
  // the other orientation has its own (default) layout
  await p.setViewportSize({ width: vh, height: vw }); await sleep(500);
  d = await dbg(p);
  check(d.orient === 'portrait' && !d.layout, `${S.name}: portrait keeps its own layout (default here)`);
  await p.setViewportSize({ width: vw, height: vh }); await sleep(500);
  d = await dbg(p);
  check(d.orient === 'landscape' && !!d.layout, `${S.name}: rotating back restores the landscape layout`);
  // reset
  await p.$eval('#btnPause', (b) => b.click()); await p.$eval('#bSettingsP', (b) => b.click());
  await p.tap('#bResetCtl'); await sleep(300);
  d = await dbg(p);
  check(!d.layout && !(await p.evaluate(() => document.getElementById('tJ').classList.contains('ctl-custom'))), `${S.name}: Reset to default clears the layout`);
  await ctx.close();
}
console.log(`\n${report.length} passed, ${fail.length} failed`);
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
await browser.close();
process.exit(fail.length || errs.length ? 1 : 0);
