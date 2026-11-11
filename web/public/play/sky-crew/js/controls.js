// Sky Crew touch control layout editor: drag any on-screen control, pick a size and opacity,
// saved per device in localStorage, separately for landscape and portrait, always clamped inside the safe area.
const KEY = 'skycrew.controls.v1';
export const CONTROLS = [
  { id: 'joy', label: 'Move stick' },
  { id: 'tE', label: 'Interact (E)' },
  { id: 'tJ', label: 'Jump' },
  { id: 'tRun', label: 'Sprint' },
  { id: 'tV', label: 'Camera' },
  { id: 'tChat', label: 'Chat' },
  { id: 'tF', label: 'Gadget' },
  { id: 'tAlt', label: 'Gadget mode' },
  { id: 'tFlight', label: 'Flight buttons' },
  { id: 'btnAdmin', label: 'Dev / staff panel', staffOnly: true },
  { id: 'btnPause', label: 'Pause' },
];
export const SIZES = { S: 0.8, M: 1, L: 1.3 };
const $ = (s) => document.getElementById(s);

let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ } };
export const orient = () => (innerWidth >= innerHeight ? 'landscape' : 'portrait');
const layout = () => store[orient()] || null;

// env(safe-area-inset-*) read through a probe element
let probe = null;
function insets() {
  if (!probe) { probe = document.createElement('div'); probe.className = 'sa-probe'; document.body.appendChild(probe); }
  const cs = getComputedStyle(probe);
  return { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
}
const M = 4; // keep a small margin from the safe edge
function clampCenter(el, x, y, s, c) {
  // hidden controls (display:none) measure 0: use the size recorded while editing
  if (c && el.offsetWidth) { c.w = el.offsetWidth; c.h = el.offsetHeight; }
  const w = (el.offsetWidth || c?.w || 56) * s, h = (el.offsetHeight || c?.h || 56) * s, i = insets();
  const minX = i.l + M + w / 2, maxX = innerWidth - i.r - M - w / 2, minY = i.t + M + h / 2, maxY = innerHeight - i.b - M - h / 2;
  return { x: minX > maxX ? innerWidth / 2 : Math.min(maxX, Math.max(minX, x)), y: minY > maxY ? innerHeight / 2 : Math.min(maxY, Math.max(minY, y)) };
}
function place(el, c) {
  const p = clampCenter(el, c.x * innerWidth, c.y * innerHeight, c.s, c);
  el.classList.add('ctl-custom');
  el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
  el.style.transform = `translate(-50%, -50%) scale(${c.s})`;
  return p;
}
function unplace(el) { el.classList.remove('ctl-custom'); el.style.left = el.style.top = el.style.transform = el.style.opacity = ''; }

/** apply the saved layout for the current orientation (or the built-in default when there is none) */
export function applyLayout() {
  const L = layout();
  for (const d of CONTROLS) {
    const el = $(d.id); if (!el) continue;
    const c = L?.items?.[d.id];
    if (c) { place(el, c); el.style.opacity = String(L.opacity ?? 1); } else unplace(el);
  }
}

export const ctl = { editing: false, sel: null };
let isStaff = () => false, onDone = () => {};
const eligible = () => CONTROLS.filter((d) => $(d.id) && (!d.staffOnly || isStaff()));

function snapshot() { // pin every control where it is now so moving one never reflows the others
  const items = {};
  for (const d of eligible()) {
    const el = $(d.id); const r = el.getBoundingClientRect(); if (!r.width) continue;
    const s = layout()?.items?.[d.id]?.s ?? 1;
    items[d.id] = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, s, w: el.offsetWidth, h: el.offsetHeight };
  }
  return items;
}

function ensureLayout() {
  if (!store[orient()]) { store[orient()] = { items: snapshot(), opacity: 1 }; save(); applyLayout(); }
  return store[orient()];
}

function renderBar() {
  const L = layout();
  const d = CONTROLS.find((c) => c.id === ctl.sel);
  $('ctlSel').textContent = d ? d.label : 'Tap a control to select it, drag to move it';
  const s = d && L?.items?.[d.id]?.s;
  for (const k of Object.keys(SIZES)) { const b = $(`ctlSize${k}`); b.disabled = !d; b.classList.toggle('on', !!d && s === SIZES[k]); }
  $('ctlOpacity').value = String(L?.opacity ?? 1);
  $('ctlOpacityVal').textContent = `${Math.round((L?.opacity ?? 1) * 100)}%`;
  for (const c of eligible()) $(c.id).classList.toggle('ctl-sel', c.id === ctl.sel);
}

export function openEditor() {
  ctl.editing = true; ctl.sel = null;
  document.body.classList.add('ctl-editing');
  for (const d of eligible()) $(d.id).classList.add('ctl-force');
  $('ctlEdit').classList.remove('hidden');
  ensureLayout(); applyLayout(); renderBar();
}
export function closeEditor() {
  ctl.editing = false; ctl.sel = null;
  for (const d of CONTROLS) { const el = $(d.id); if (el) el.classList.remove('ctl-force', 'ctl-sel'); }
  document.body.classList.remove('ctl-editing');
  $('ctlEdit').classList.add('hidden');
  applyLayout(); onDone();
}
export function resetLayout() {
  delete store[orient()]; save(); applyLayout();
  if (ctl.editing) { requestAnimationFrame(() => { ensureLayout(); applyLayout(); renderBar(); }); }
}

function hit(x, y) {
  const list = eligible().reverse();
  for (const d of list) { const r = $(d.id).getBoundingClientRect(); if (r.width && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return d.id; }
  return null;
}

export function initControls({ staff, done } = {}) {
  if (staff) isStaff = staff; if (done) onDone = done;
  const ov = $('ctlEdit');
  let drag = null;
  ov.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#ctlBar')) return;
    e.preventDefault(); e.stopPropagation();
    const id = hit(e.clientX, e.clientY);
    ctl.sel = id; renderBar();
    if (!id) return;
    const r = $(id).getBoundingClientRect();
    drag = { id, pid: e.pointerId, dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2) };
    try { ov.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  ov.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    const L = ensureLayout(), c = L.items[drag.id] || (L.items[drag.id] = { x: 0.5, y: 0.5, s: 1 });
    const p = clampCenter($(drag.id), e.clientX - drag.dx, e.clientY - drag.dy, c.s, c);
    c.x = p.x / innerWidth; c.y = p.y / innerHeight; place($(drag.id), c);
  });
  const end = (e) => { if (!drag || e.pointerId !== drag.pid) return; drag = null; save(); };

  ov.addEventListener('pointerup', end); ov.addEventListener('pointercancel', end);
  for (const k of Object.keys(SIZES)) $(`ctlSize${k}`).addEventListener('click', () => {
    if (!ctl.sel) return; const L = ensureLayout(); const c = L.items[ctl.sel]; if (!c) return;
    c.s = SIZES[k]; const p = place($(ctl.sel), c); c.x = p.x / innerWidth; c.y = p.y / innerHeight; save(); renderBar();
  });
  $('ctlOpacity').addEventListener('input', (e) => { const L = ensureLayout(); L.opacity = Math.max(0.3, Math.min(1, +e.target.value)); save(); applyLayout(); renderBar(); });
  $('ctlReset').addEventListener('click', resetLayout);
  $('ctlDone').addEventListener('click', closeEditor);
  addEventListener('resize', () => requestAnimationFrame(() => { applyLayout(); if (ctl.editing) { ensureLayout(); applyLayout(); renderBar(); } }));
  applyLayout();
}
/** for tests */
export const controlsDebug = () => ({ orient: orient(), editing: ctl.editing, sel: ctl.sel, layout: layout(), insets: insets(),
  rects: Object.fromEntries(CONTROLS.map((d) => { const el = $(d.id); if (!el) return [d.id, null]; const r = el.getBoundingClientRect(); return [d.id, r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom, op: getComputedStyle(el).opacity } : null]; })) });
