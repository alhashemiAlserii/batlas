// Rotate-hint matrix (WebKit). Phones in portrait ask to turn sideways. iPads (portrait and
// landscape), desktops, and a phone-sized *layout* viewport on an iPad-sized screen do not.
// Rotating a phone viewport from portrait to landscape dismisses the hint and Solo can start.
//
// The cases at the top do not need a browser: they are the measurements Safari actually
// reports when the layout viewport is still the previous orientation, or when an iPad's
// layout/visual viewport is phone-sized while screen.width/height are the iPad.
//
// Usage: node orientation.mjs   (BASE=http://localhost:3200)
import { shouldShowRotateHint } from '../web/public/play/sky-crew/js/orient.js';

const report = [], fail = [];
const check = (c, m) => { (c ? report : fail).push(m); console.log(`${c ? '✔' : '✘'} ${m}`); };

const phone = { pointerFine: false, hover: false, maxTouchPoints: 5 };
const desktop = { pointerFine: true, hover: true, maxTouchPoints: 0 };
// What Safari reports for a beat after orientationchange, before innerWidth / visualViewport swap.
const stale = (angle, innerW, innerH) => ({
  ...phone,
  screenW: Math.min(innerW, innerH) < 500 ? Math.min(innerW, innerH) : innerW,
  screenH: Math.max(innerW, innerH),
  innerW, innerH, vvW: innerW, vvH: innerH, vvScale: 1,
  angle, screenAngle: angle < 0 ? 270 : angle, type: Math.abs(angle) === 90 ? 'landscape-primary' : 'portrait-primary',
  pendingOrientation: true,
});

const CASES = [
  ['iphone portrait 390×844', true, { ...phone, screenW: 390, screenH: 844, innerW: 390, innerH: 844, vvW: 390, vvH: 844, vvScale: 1, angle: 0, type: 'portrait-primary' }],
  ['iphone portrait 430×932', true, { ...phone, screenW: 430, screenH: 932, innerW: 430, innerH: 932, vvW: 430, vvH: 700, vvScale: 1, angle: 0, type: 'portrait-primary' }],
  ['iphone landscape 844×390', false, { ...phone, screenW: 390, screenH: 844, innerW: 844, innerH: 390, vvW: 844, vvH: 390, vvScale: 1, angle: 90, type: 'landscape-primary' }],
  ['iphone landscape 932×430', false, { ...phone, screenW: 430, screenH: 932, innerW: 932, innerH: 430, vvW: 932, vvH: 340, vvScale: 1, angle: -90, type: 'landscape-primary' }],
  ['ipad portrait 768×1024', false, { ...phone, screenW: 768, screenH: 1024, innerW: 768, innerH: 1024, vvW: 768, vvH: 1024, vvScale: 1, angle: 0, type: 'portrait-primary' }],
  ['ipad portrait 820×1180', false, { ...phone, screenW: 820, screenH: 1180, innerW: 820, innerH: 1180, vvW: 820, vvH: 1100, vvScale: 1, angle: 0, type: 'portrait-primary' }],
  ['ipad landscape 1180×820', false, { ...phone, screenW: 820, screenH: 1180, innerW: 1180, innerH: 820, vvW: 1180, vvH: 820, vvScale: 1, angle: 90, type: 'landscape-primary' }],
  ['ipad landscape 1024×768', false, { ...phone, screenW: 768, screenH: 1024, innerW: 1024, innerH: 768, vvW: 1024, vvH: 768, vvScale: 1, angle: 90, type: 'landscape-primary' }],
  // Safari: layout + visual viewport still phone-sized, but the screen is an iPad.
  ['ipad screen, phone-sized layout viewport', false, { ...phone, screenW: 820, screenH: 1180, innerW: 430, innerH: 932, vvW: 390, vvH: 700, vvScale: 1, angle: 0, type: 'portrait-primary' }],
  ['ipad screen, phone-sized visualViewport only', false, { ...phone, screenW: 768, screenH: 1024, innerW: 768, innerH: 1024, vvW: 414, vvH: 800, vvScale: 1, angle: 0, type: 'portrait-primary' }],
  ['desktop 1440×900', false, { ...desktop, screenW: 1440, screenH: 900, innerW: 1440, innerH: 900, vvW: 1440, vvH: 900, vvScale: 1, angle: null, type: '' }],
  ['desktop narrow portrait window', false, { ...desktop, screenW: 1440, screenH: 900, innerW: 500, innerH: 800, vvW: 500, vvH: 800, vvScale: 1, angle: null, type: 'portrait-primary' }],
  ['mac touch screen, narrow portrait window', false, { pointerFine: false, hover: false, maxTouchPoints: 5, screenW: 1440, screenH: 900, innerW: 500, innerH: 900, vvW: 500, vvH: 900, vvScale: 1, angle: null, type: '' }],
  // Rotation: viewports still portrait, window.orientation already landscape.
  ['safari rotate to landscape, viewports still portrait', false, stale(90, 390, 844)],
  ['safari rotate 932-wide phone to landscape, viewports still portrait', false, stale(-90, 430, 932)],
  ['safari rotate back to portrait, viewports still landscape', true, { ...phone, screenW: 390, screenH: 844, innerW: 844, innerH: 390, vvW: 844, vvH: 390, vvScale: 1, angle: 0, type: 'portrait-primary', pendingOrientation: true }],
  // visualViewport already flipped, layout viewport still old, orientation event not required.
  ['safari visualViewport landscape while layout still portrait', false, { ...phone, screenW: 430, screenH: 932, innerW: 430, innerH: 932, vvW: 932, vvH: 430, vvScale: 1, angle: 0, type: 'portrait-primary', pendingOrientation: false }],
  // Pinch-zoom must not turn a landscape phone into a portrait hint (visual viewport is a crop).
  ['zoomed landscape phone', false, { ...phone, screenW: 390, screenH: 844, innerW: 844, innerH: 390, vvW: 200, vvH: 300, vvScale: 2, angle: 90, type: 'landscape-primary' }],
  ['unknown sizes', false, { screenW: 0, screenH: 0, innerW: 0, innerH: 0 }],
];

console.log('— decision function (Safari measurement cases) —');
for (const [name, expectHint, metrics] of CASES) {
  let got = null, err = '';
  try { got = shouldShowRotateHint(metrics); } catch (e) { err = e.message; }
  check(!err && got === expectHint, `${name}: ${expectHint ? 'show' : 'hide'} hint${err ? ` (${err})` : got === expectHint ? '' : ` (got ${got})`}`);
}

const { webkit, devices } = await import('playwright');
const B = process.env.BASE || 'http://localhost:3200';
const PH = devices['iPhone 15'].userAgent;
const PAD = devices['iPad Pro 11'].userAgent;
const MAC = devices['Desktop Safari'].userAgent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOISE = /Refused to apply a stylesheet|Refused to apply inline style|apply inline style|WebGL/i;
const errs = [];
const browser = await webkit.launch();

async function open(opts) {
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    screen: opts.screen || { width: opts.viewport.width, height: opts.viewport.height },
    userAgent: opts.ua,
    deviceScaleFactor: opts.scale || 2,
    isMobile: !!opts.mobile,
    hasTouch: !!opts.touch,
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('skycrew.quality', 'low'); localStorage.setItem('skycrew.skipAirport', '1'); localStorage.removeItem('skycrew.controls.v1'); } catch { /* ignore */ }
  });
  const p = await ctx.newPage();
  const label = opts.name;
  p.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errs.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${label}] pageerror ${e.message}`));
  await p.goto(`${B}/play/sky-crew?fps=4`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.skyCrew?.ready, null, { polling: 250, timeout: 30000 });
  return { ctx, p };
}

const hintVisible = (p) => p.isVisible('#rotateHint');
async function hintBlocks(p) {
  return p.evaluate(() => {
    const el = document.getElementById('rotateHint');
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return !!(hit && (hit === el || el.contains(hit)));
  });
}

const PAGES = [
  { name: 'iphone-portrait-390x844', viewport: { width: 390, height: 844 }, ua: PH, mobile: true, touch: true, hint: true },
  { name: 'iphone-portrait-430x932', viewport: { width: 430, height: 932 }, ua: PH, mobile: true, touch: true, hint: true },
  { name: 'iphone-landscape-844x390', viewport: { width: 844, height: 390 }, ua: PH, mobile: true, touch: true, hint: false },
  { name: 'iphone-landscape-932x430', viewport: { width: 932, height: 430 }, ua: PH, mobile: true, touch: true, hint: false },
  { name: 'ipad-portrait-768x1024', viewport: { width: 768, height: 1024 }, ua: PAD, mobile: true, touch: true, hint: false, play: true },
  { name: 'ipad-portrait-820x1180', viewport: { width: 820, height: 1180 }, ua: PAD, mobile: true, touch: true, hint: false },
  { name: 'ipad-landscape-1024x768', viewport: { width: 1024, height: 768 }, ua: PAD, mobile: true, touch: true, hint: false },
  { name: 'ipad-landscape-1180x820', viewport: { width: 1180, height: 820 }, ua: PAD, mobile: true, touch: true, hint: false },
  { name: 'desktop-1440x900', viewport: { width: 1440, height: 900 }, ua: MAC, mobile: false, touch: false, hint: false, play: true },
  { name: 'desktop-narrow-portrait', viewport: { width: 500, height: 900 }, screen: { width: 1440, height: 900 }, ua: MAC, mobile: false, touch: false, hint: false },
  // CSS (pointer: coarse) + (orientation: portrait) + (max-width: 600px) matches this.
  // The screen is an iPad, so the hint must stay hidden. This is the bug the media query had.
  { name: 'ipad-screen-phone-viewport', viewport: { width: 430, height: 932 }, screen: { width: 820, height: 1180 }, ua: PAD, mobile: true, touch: true, hint: false, phoneCss: true },
];

console.log('— WebKit pages —');
for (const S of PAGES) {
  const { ctx, p } = await open(S);
  const visible = await hintVisible(p);
  const blocks = await hintBlocks(p);
  const text = await p.locator('#rotateHint').textContent();
  check(visible === S.hint, `${S.name}: rotate hint ${S.hint ? 'visible' : 'hidden'}`);
  check(blocks === S.hint, `${S.name}: hint ${S.hint ? 'covers' : 'does not cover'} the screen`);
  check(text.includes('Turn your phone sideways'), `${S.name}: hint copy is the Sky Crew line`);
  if (S.hint) {
    // The old rule was a media query, so removing the class left the overlay up on Safari.
    await p.evaluate(() => document.documentElement.classList.remove('phone-portrait'));
    check(!(await hintVisible(p)), `${S.name}: hint is the class, not a stuck orientation media query`);
  }
  if (S.phoneCss) {
    const mq = await p.evaluate(() => matchMedia('(pointer: coarse) and (orientation: portrait) and (max-width: 600px)').matches);
    check(mq, `${S.name}: CSS viewport query matches a phone (the old bug) while the screen is an iPad`);
    check(!visible, `${S.name}: iPad screen is not asked to rotate`);
  }
  if (S.play) {
    await p.locator('#bSolo').click({ timeout: 8000 });
    await p.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 15000 });
    check(await p.evaluate(() => window.skyCrew.state().playing && !document.documentElement.classList.contains('phone-portrait')), `${S.name}: Solo starts and the hint stays down`);
  }
  const same = await p.evaluate((cases) => cases.every(([name, expectHint, metrics]) => window.skyCrew.shouldRotate(metrics) === expectHint), CASES);
  check(same, `${S.name}: page uses the same decision as the suite`);
  await ctx.close();
}

console.log('— rotate a phone viewport —');
for (const rot of [
  { name: '390x844 → 844x390', from: { width: 390, height: 844 }, to: { width: 844, height: 390 } },
  { name: '430x932 → 932x430', from: { width: 430, height: 932 }, to: { width: 932, height: 430 } },
]) {
  const { ctx, p } = await open({ name: `rotate-${rot.name}`, viewport: rot.from, ua: PH, mobile: true, touch: true });
  check(await hintVisible(p), `${rot.name}: portrait starts with the hint`);
  await p.setViewportSize(rot.to);
  await p.waitForFunction(() => !document.documentElement.classList.contains('phone-portrait'), null, { timeout: 3000 });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const visible = await hintVisible(p);
  const blocks = await hintBlocks(p);
  const box = await p.evaluate(() => {
    const c = document.querySelector('#view canvas');
    return { cw: c?.clientWidth || 0, ch: c?.clientHeight || 0, w: window.innerWidth, h: window.innerHeight };
  });
  check(!visible && !blocks, `${rot.name}: landscape dismisses the hint`);
  check(box.w === rot.to.width && box.h === rot.to.height && box.cw >= rot.to.width - 2 && box.ch >= rot.to.height - 2 && box.cw > box.ch, `${rot.name}: view is landscape (${box.cw}×${box.ch})`);
  await p.locator('#bSolo').click({ timeout: 8000 });
  await p.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 15000 });
  const playing = await p.evaluate(() => window.skyCrew.state().playing);
  check(playing && !(await hintBlocks(p)), `${rot.name}: game is playable in landscape`);
  // Back to portrait: the hint returns immediately (the listener is not one-shot).
  await p.setViewportSize(rot.from);
  await p.waitForFunction(() => document.documentElement.classList.contains('phone-portrait'), null, { timeout: 3000 });
  check(await hintVisible(p) && await hintBlocks(p), `${rot.name}: portrait shows the hint again`);
  await ctx.close();
}

console.log('— iPad portrait ↔ landscape never hints —');
{
  const { ctx, p } = await open({ name: 'ipad-rotate', viewport: { width: 820, height: 1180 }, ua: PAD, mobile: true, touch: true });
  check(!(await hintVisible(p)), 'ipad 820×1180 portrait: no hint');
  await p.setViewportSize({ width: 1180, height: 820 });
  await sleep(50);
  check(!(await hintVisible(p)) && !(await hintBlocks(p)), 'ipad rotated to 1180×820: still no hint');
  await p.locator('#bSolo').click({ timeout: 8000 });
  await p.waitForFunction(() => window.skyCrew.state().playing, null, { timeout: 15000 });
  check(await p.evaluate(() => window.skyCrew.state().playing), 'ipad landscape: Solo starts');
  await p.setViewportSize({ width: 768, height: 1024 });
  await sleep(50);
  check(!(await hintVisible(p)), 'ipad 768×1024 portrait: no hint');
  await ctx.close();
}

await browser.close();
console.log(`\n${report.length} passed, ${fail.length} failed`);
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
process.exit(fail.length || errs.length ? 1 : 0);
