// Phone-portrait "turn your phone sideways" hint.
//
// Safari/WebKit does not keep @media (orientation) / (max-width) in step with the
// device. This page locks scrolling (html, body { overflow: hidden }) and the
// viewport (maximum-scale=1), so after a rotation WebKit leaves the layout
// viewport — and therefore those media queries — at the size from page load.
// window.orientation and visualViewport update immediately; the stylesheet does
// not. A phone rotated to landscape kept the overlay up and could not be played.
//
// The same query also treated "layout/visual viewport narrower than 600px" as
// "this is a phone". iPad portrait (768×1024, 820×1180) and a Mac window can
// report a phone-sized layout or visual viewport (stuck viewport, split view,
// Safari chrome, zoom) while screen.width/height are still a tablet or a
// monitor. iPads and desktops then got the phone overlay. Pointer: coarse is
// true for every iPad, so it does not separate phones from tablets.

/** Short side, in CSS pixels, below which a device is a phone.
 *  iPhone 16 Pro Max is 440. The smallest iPad (mini) is 744; other iPads are 768 or 820. */
export const PHONE_SHORT_SIDE = 600;

function shortSide(w, h) {
  if (!(w > 0) || !(h > 0)) return 0;
  return Math.min(w, h);
}

/** @returns {true|false|null} */
export function orientationPortrait(m) {
  // window.orientation (iOS): 0 / 180 portrait, ±90 landscape. It updates on
  // orientationchange before innerWidth swaps. screen.orientation.angle is
  // 0 / 90 / 180 / 270.
  if (typeof m.angle === 'number' && Number.isFinite(m.angle)) return Math.abs(m.angle) % 180 === 0;
  if (typeof m.screenAngle === 'number' && Number.isFinite(m.screenAngle)) return m.screenAngle % 180 === 0;
  if (typeof m.type === 'string' && m.type.startsWith('portrait')) return true;
  if (typeof m.type === 'string' && m.type.startsWith('landscape')) return false;
  return null;
}

function aspects(m) {
  const zoomed = (m.vvScale || 1) > 1.05;
  const vW = zoomed ? 0 : m.vvW;
  const vH = zoomed ? 0 : m.vvH;
  const visualKnown = vW > 0 && vH > 0 && vW !== vH;
  const layoutKnown = m.innerW > 0 && m.innerH > 0 && m.innerW !== m.innerH;
  return {
    visualKnown,
    layoutKnown,
    visualPortrait: visualKnown && vH > vW,
    layoutPortrait: layoutKnown && m.innerH > m.innerW,
  };
}

/** Portrait vs landscape from the live viewport, not from a CSS media query. */
export function isPortrait(m) {
  const a = aspects(m);
  const api = orientationPortrait(m);
  // visualViewport flips before the layout viewport on Safari. Trust it when
  // they disagree, unless an orientation event just said otherwise.
  if (a.visualKnown && a.layoutKnown && a.visualPortrait !== a.layoutPortrait) {
    if (m.pendingOrientation && api !== null) return api;
    return a.visualPortrait;
  }
  // Both viewports still show the pre-rotation size. window.orientation is already new.
  if (m.pendingOrientation && api !== null && a.layoutKnown && api !== a.layoutPortrait) return api;
  if (a.visualKnown) return a.visualPortrait;
  if (a.layoutKnown) return a.layoutPortrait;
  if (api !== null) return api;
  return false;
}

/**
 * @param {object} m
 * @param {number} m.screenW screen.width (device, not the window)
 * @param {number} m.screenH
 * @param {number} m.innerW layout viewport
 * @param {number} m.innerH
 * @param {number} [m.vvW] visualViewport width
 * @param {number} [m.vvH]
 * @param {number} [m.vvScale]
 * @param {number|null} [m.angle] window.orientation
 * @param {number|null} [m.screenAngle] screen.orientation.angle
 * @param {string} [m.type] screen.orientation.type
 * @param {boolean} [m.pendingOrientation] true only right after orientationchange, while sizes may be stale
 * @param {boolean} [m.pointerFine]
 * @param {boolean} [m.hover]
 * @param {number} [m.maxTouchPoints]
 */
export function shouldShowRotateHint(m) {
  // A mouse/trackpad with no touch screen is a computer, even if the window
  // is a tall strip narrower than a phone. iPhones always have touch points.
  if (m.pointerFine && m.hover && !(m.maxTouchPoints > 0)) return false;
  // Any measurement that is clearly a tablet or computer wins. Safari can
  // report a phone-sized layout or visual viewport for an iPad; the screen
  // (or the other viewport) is still ≥744 CSS px on the short side.
  const short = Math.max(shortSide(m.screenW, m.screenH), shortSide(m.innerW, m.innerH), shortSide(m.vvW, m.vvH));
  if (!(short > 0 && short < PHONE_SHORT_SIDE)) return false;
  return isPortrait(m);
}

function readMetrics(win, pendingOrientation) {
  const vv = win.visualViewport;
  const s = win.screen || {};
  const o = s.orientation;
  let pointerFine = false, hover = false;
  try { pointerFine = win.matchMedia('(pointer: fine)').matches; } catch { /* old webview */ }
  try { hover = win.matchMedia('(hover: hover)').matches; } catch { /* old webview */ }
  return {
    screenW: s.width || 0,
    screenH: s.height || 0,
    innerW: win.innerWidth || 0,
    innerH: win.innerHeight || 0,
    vvW: vv?.width || 0,
    vvH: vv?.height || 0,
    vvScale: vv?.scale || 1,
    angle: typeof win.orientation === 'number' ? win.orientation : null,
    screenAngle: o && typeof o.angle === 'number' ? o.angle : null,
    type: (o && o.type) || '',
    pendingOrientation,
    pointerFine,
    hover,
    maxTouchPoints: win.navigator?.maxTouchPoints || 0,
  };
}

/** Force WebKit to recompute a layout viewport it froze at the old orientation. */
function kickViewport(win) {
  const meta = win.document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const content = meta.getAttribute('content') || '';
  if (!content.includes('initial-scale=1')) return;
  meta.setAttribute('content', content.replace('initial-scale=1', 'initial-scale=1.0001'));
  win.requestAnimationFrame(() => {
    if (meta.getAttribute('content') !== content) meta.setAttribute('content', content);
  });
}

/**
 * Show #rotateHint only for a phone held in portrait, and keep it in sync when
 * Safari rotates (including the frames before innerWidth updates).
 * @param {Window} [win]
 * @param {() => void} [onChange] called after the viewport size may have changed (resize the canvas)
 */
export function installRotateHint(win = window, onChange = () => {}) {
  let pending = false;
  let changeRaf = 0;
  const root = win.document.documentElement;

  const queueChange = () => {
    if (changeRaf) return;
    changeRaf = win.requestAnimationFrame(() => { changeRaf = 0; try { onChange(); } catch { /* caller */ } });
  };

  const applyNow = () => {
    const m = readMetrics(win, pending);
    const show = shouldShowRotateHint(m);
    root.classList.toggle('phone-portrait', show);
    const el = win.document.getElementById('rotateHint');
    if (el) el.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (pending) {
      const a = aspects(m);
      const api = orientationPortrait(m);
      if (api === null || (a.layoutKnown && api === a.layoutPortrait)) pending = false;
    }
    return show;
  };

  const onOrientation = () => {
    pending = true;
    applyNow();
    const m = readMetrics(win, true);
    const a = aspects(m);
    const api = orientationPortrait(m);
    if (api !== null && a.layoutKnown && api !== a.layoutPortrait) kickViewport(win);
    queueChange();
    win.requestAnimationFrame(() => { applyNow(); queueChange(); });
    win.setTimeout(() => { applyNow(); queueChange(); }, 60);
    win.setTimeout(() => { applyNow(); queueChange(); }, 250);
  };

  win.addEventListener('resize', () => { applyNow(); queueChange(); });
  win.addEventListener('orientationchange', onOrientation);
  win.visualViewport?.addEventListener('resize', () => { applyNow(); queueChange(); });
  // The toolbar show/hide scrolls the visual viewport without a window resize.
  win.visualViewport?.addEventListener('scroll', () => { applyNow(); });
  try { win.screen?.orientation?.addEventListener?.('change', onOrientation); } catch { /* not available */ }
  applyNow();

  return {
    apply: applyNow,
    debug: () => ({ show: root.classList.contains('phone-portrait'), pending, metrics: readMetrics(win, pending) }),
  };
}
