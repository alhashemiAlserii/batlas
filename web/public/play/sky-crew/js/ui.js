// DOM HUD helpers (no inline styles: the site CSP forbids them; JS CSSOM is fine).
const $ = (s) => document.querySelector(s);
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}
export const show = (s, on = true) => $(s).classList.toggle('hidden', !on);

export function toast(msg, kind = 'info', ms = 4200) {
  const box = $('#toasts');
  const t = el('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) if (k) n.append(k);
  return n;
}
function dutyMark(state) {
  const s = svg('svg', { viewBox: '0 0 16 16', class: 'mark', 'aria-hidden': 'true' });
  if (state === 'done') {
    s.append(svg('circle', { cx: '8', cy: '8', r: '7', fill: 'currentColor' }));
    s.append(svg('path', { d: 'M4.2 8.2 6.7 10.7 11.8 5.4', fill: 'none', stroke: '#15191e', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  } else if (state === 'warn') {
    s.append(svg('path', { d: 'M8 2.2 14.2 13.4H1.8L8 2.2z', fill: 'currentColor' }));
    s.append(svg('path', { d: 'M8 6.2v3.4', stroke: '#15191e', 'stroke-width': '1.4', 'stroke-linecap': 'round' }));
  } else if (state === 'now') {
    s.append(svg('circle', { cx: '8', cy: '8', r: '6.2', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }));
    s.append(svg('circle', { cx: '8', cy: '8', r: '2.5', fill: 'currentColor' }));
  } else {
    s.append(svg('circle', { cx: '8', cy: '8', r: '6.2', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }));
  }
  return s;
}
function dutyBell() {
  return svg('svg', { viewBox: '0 0 16 16', class: 'mark bell', 'aria-hidden': 'true' },
    svg('path', { d: 'M8 1.8a.7.7 0 0 1 .7.7v.45a3.9 3.9 0 0 1 3.1 3.8v2.1l.9 1.6H3.3l.9-1.6V6.75A3.9 3.9 0 0 1 7.3 2.95V2.5A.7.7 0 0 1 8 1.8zM6.3 12.2a1.7 1.7 0 0 0 3.4 0', fill: 'currentColor' }));
}
let dutyShape = '';
const dutyPrev = new Map();
let dutyPrimed = false;
function dutyKey(m) {
  const task = (m.tasks || []).map((t) => [t.id, t.label, t.state, t.progress?.cur ?? '', t.progress?.max ?? '']).join(';');
  const call = (m.calls || []).map((c) => [c.id, c.label, c.hot ? 1 : 0]).join(';');
  return `${m.phase}|${m.route}|${m.compact ? 1 : 0}|${task}|${call}`;
}
function dutyRow(t, fresh) {
  const hasProgress = t.progress && t.progress.max > 0;
  const hasTimer = t.timer != null && t.limit;
  const bar = hasProgress || hasTimer ? el('span', { class: `duty-bar${hasTimer ? ' urg' : ''}` }, el('i', { 'data-bar': t.id })) : null;
  const count = t.meter || (hasProgress ? `${t.progress.cur}/${t.progress.max}` : '');
  const row = el('div', { class: `o${t.state ? ` ${t.state}` : ''}${fresh ? ' fresh' : ''}`, 'data-id': t.id },
    el('span', { class: 'duty-ico' }, dutyMark(t.state === 'note' ? '' : t.state)),
    el('span', { class: 'duty-main' }, el('span', { class: 'duty-label' }, t.label), bar),
    el('span', { class: 'duty-num', 'data-meter': t.id }, count));
  if (bar) {
    const i = row.querySelector('i');
    const pct = hasProgress ? (t.progress.cur / t.progress.max) * 100 : (1 - t.timer / t.limit) * 100;
    i.style.width = `${Math.max(hasTimer ? 4 : 0, Math.min(100, pct))}%`;
  }
  return row;
}
function dutyCall(c) {
  const row = el('div', { class: `o call${c.now ? ' now' : ''}${c.hot ? ' hot' : ''}`, 'data-id': c.id },
    el('span', { class: 'duty-ico' }, dutyBell()),
    el('span', { class: 'duty-main' }, el('span', { class: 'duty-label' }, c.label), el('span', { class: 'duty-bar urg' }, el('i', { 'data-bar': c.id }))),
    el('span', { class: 'duty-num', 'data-meter': c.id }, ''));
  return row;
}
/** Polished objectives panel. model: { phase, route, compact, tasks, calls }. */
export function objectives(model) {
  const box = $('#obj');
  if (!box || !model) return;
  const key = dutyKey(model);
  if (key !== dutyShape) {
    dutyShape = key;
    const tasks = model.tasks || [];
    const tracked = tasks.filter((t) => t.track);
    const doneN = tracked.filter((t) => t.state === 'done').length;
    const fresh = new Set();
    if (dutyPrimed) for (const t of tasks) if (t.state === 'done' && dutyPrev.has(t.id) && dutyPrev.get(t.id) !== 'done') fresh.add(t.id);
    for (const t of tasks) dutyPrev.set(t.id, t.state || '');
    for (const id of [...dutyPrev.keys()]) if (!tasks.some((t) => t.id === id)) dutyPrev.delete(id);
    dutyPrimed = true;
    const head = el('button', { type: 'button', class: 'duty-head', 'aria-expanded': model.compact ? 'false' : 'true', 'aria-controls': 'dutyBody' },
      el('span', { class: 'duty-phase' }, model.phase || 'Flight'),
      el('span', { class: 'duty-route' }, model.route || ''),
      tracked.length ? el('span', { class: 'duty-count' }, `${doneN}/${tracked.length}`) : null,
      el('span', { class: 'duty-chev', 'aria-hidden': 'true' }, model.compact ? '▸' : '▾'));
    const body = el('div', { class: 'duty-body', id: 'dutyBody' },
      ...tasks.map((t) => dutyRow(t, fresh.has(t.id))),
      ...(model.calls || []).map(dutyCall));
    box.classList.toggle('is-compact', !!model.compact);
    box.replaceChildren(head, body);
  }
  for (const t of model.tasks || []) {
    if (t.meter == null && t.timer == null) continue;
    const n = box.querySelector(`[data-meter="${t.id}"]`);
    if (!n) continue;
    const text = t.timer != null ? `${t.timer}s` : t.meter;
    if (n.textContent !== text) n.textContent = text;
    if (t.timer != null && t.limit) {
      const i = box.querySelector(`[data-bar="${t.id}"]`);
      if (i) i.style.width = `${Math.max(4, Math.min(100, (1 - t.timer / t.limit) * 100))}%`;
    }
  }
  for (const c of model.calls || []) {
    const n = box.querySelector(`[data-meter="${c.id}"]`);
    if (n) {
      const text = `${Math.max(0, Math.round(c.left))}s`;
      if (n.textContent !== text) n.textContent = text;
    }
    const i = box.querySelector(`[data-bar="${c.id}"]`);
    if (i && c.limit) i.style.width = `${Math.max(4, Math.min(100, ((c.limit - c.left) / c.limit) * 100))}%`;
    const row = box.querySelector(`[data-id="${c.id}"]`);
    if (row) row.classList.toggle('hot', !!c.hot);
  }
}
let lastPrompt = null;
export function prompt(text) {
  if (text === lastPrompt) return; lastPrompt = text;
  const p = $('#prompt');
  if (!text) return p.classList.add('hidden');
  p.replaceChildren(el('kbd', {}, document.body.classList.contains('touch') ? 'Use' : 'E'), text);
  p.classList.remove('hidden');
}
let lastHeld = null;
export function held(text) {
  if (text === lastHeld) return; lastHeld = text;
  const h = $('#held');
  if (!text) return h.classList.add('hidden');
  h.textContent = text; h.classList.remove('hidden');
}

export function flightHud(f, { kt, ft, distKm, bearing, warnings, dest, gearDown }) {
  $('#fDest').textContent = dest || 'DST';
  const g = $('#fGear'); g.textContent = gearDown ? 'DN' : 'UP'; g.className = gearDown ? 'gear-dn' : 'gear-up';
  $('#fSpd').textContent = Math.round(f.speed * kt);
  $('#fAlt').textContent = Math.round(Math.max(0, (f.y - 2.4) * ft));
  $('#fVs').textContent = f.vs.toFixed(1);
  $('#fThr').style.height = `${Math.round(f.throttle * 100)}%`;
  const flaps = f.flaps === 1 || f.flaps === 2 ? f.flaps : 0;
  const fp = $('#fFlaps'); if (fp) { fp.textContent = ['UP', 'TO', 'LD'][flaps]; fp.className = flaps ? 'flaps-on' : ''; }
  $('#fDist').textContent = distKm.toFixed(1);
  $('#fArrow').style.transform = `rotate(${(-bearing * 180) / Math.PI}deg)`;
  $('#fWarn').textContent = warnings.join(' · ');
}

export function roomInfo(room, myCid, rankBadge) {
  const box = $('#roominfo');
  if (!room) return box.classList.add('hidden');
  box.classList.remove('hidden');
  box.replaceChildren(
    el('div', {}, 'Room ', el('span', { class: 'code' }, room.code), ` · ${room.players.length}/8`),
    ...room.players.map((p) => el('div', { class: 'pl' }, rankBadge(p.role), el('span', { class: `name-${p.role.toLowerCase()}` }, p.displayName || p.username), p.cid === room.hostCid ? ' (host)' : '', p.cid === room.pilotCid ? ' ✈' : '', p.crew ? ` · ${CREW_LABEL[p.crew]}` : '', p.cid === myCid ? ' (you)' : '')),
  );
}

export function results(res) {
  $('#resTitle').textContent = res.crashed ? 'Crash landing… the accountants are crying' : res.landedAt === res.route ? `Payday at ${res.routeName}!` : 'Flight over: payout';
  $('#resSub').textContent = `Batlas Air ${res.contract === 'premium' ? 'premium contract' : 'standard contract'} · ${res.time}s flight${res.lost ? ` · ${res.lost} passenger${res.lost > 1 ? 's' : ''} parachuted out` : ''}`;
  $('#resStars').textContent = '★'.repeat(res.stars) + '☆'.repeat(5 - res.stars);
  $('#resTable').replaceChildren(...res.lines.map(([l, v]) => el('tr', {}, el('td', {}, l), el('td', { class: v < 0 ? 'neg' : 'pos' }, money(v, true)))));
  $('#resTotal').textContent = money(res.total);
  const shift = $('#resShift'); if (shift) shift.textContent = '';
  show('#results', true);
}

/** Service-shift score from the shared rules (server card in co-op, local card solo). */
export function shiftCard(card) {
  const eln = $('#resShift');
  if (!eln) return;
  if (!card) { eln.textContent = ''; return; }
  const stars = '★'.repeat(card.stars || 0) + '☆'.repeat(5 - (card.stars || 0));
  const bits = [`Service ${stars} · ${card.points} pts`, `${card.resolved || 0} calls answered`];
  if (card.missed) bits.push(`${card.missed} missed`);
  if (card.incidentsHandled) bits.push(`${card.incidentsHandled} incidents handled`);
  eln.textContent = bits.join(' · ');
}

export function rankBadge(role) {
  const r = ['DEVELOPER', 'ADMIN', 'TRUSTED', 'PLAYER'].includes(role) ? role : 'PLAYER';
  return el('span', { class: `rank rank-${r.toLowerCase()}` }, r);
}

/** Build the staff overlay from server-provided permissions. The server re-checks every command. */
export function buildAdmin({ you, room, myCid, send, live }) {
  const P = new Set(you.permissions || []);
  const body = $('#admBody');
  $('#admRank').replaceChildren(rankBadge(you.role));
  const sec = (title, ...kids) => el('div', { class: 'admsec' }, el('h4', {}, title), ...kids);
  const btn = (label, fn, cls = '') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  const parts = [];
  // Developer: every live room on the server (the server re-checks the rank for the list and each join)
  if (you.role === 'DEVELOPER' && live) {
    const hid = el('input', { type: 'checkbox', id: 'admHidden' }); hid.checked = !!live.hidden;
    hid.addEventListener('change', () => { live.hidden = hid.checked; });
    const rows = (live.rooms || []).map((r) => el('div', { class: 'admrow' }, el('span', {}, `${r.code}${r.locked ? ' 🔒' : ''} · ${r.host || '?'} · ${r.count}/${r.max} · ${r.route || '—'} · ${r.phase || 'lobby'}`), r.code === room?.code ? el('span', { class: 'muted small' }, 'here') : btn('Join', () => live.join(r.code, hid.checked), 'gold')));
    parts.push(sec('Live rooms (Developer)', el('div', { class: 'admgrid' }, btn('↻ Refresh', () => live.refresh())), el('label', { class: 'admrow' }, hid, el('span', {}, 'Join hidden (invisible spectator)')), ...(rows.length ? rows : [el('div', { class: 'muted small' }, live.rooms ? 'No live rooms.' : 'Press refresh.')])));
  }
  if (!room) { if (parts.length) { body.replaceChildren(...parts); return; } body.replaceChildren(el('p', { class: 'muted small' }, 'Staff tools work in a co-op room (so the game server can verify your rank). Create a room from the menu.')); return; }
  if (P.has('items.spawn.approved')) {
    const approved = [['suitcase', '🧳 Suitcase'], ['duffel', '👜 Duffel'], ['water', '💧 Water'], ['snack', '🍪 Snack'], ['blanket', '🛏 Blanket']];
    const fun = [['beach_ball', '🏐 Beach ball'], ['giant_duck', '🦆 Giant duck'], ['traffic_cone', '🚧 Cone']];
    parts.push(sec('Spawn items', el('div', { class: 'admgrid' }, ...approved.map(([id, l]) => btn(l, () => send('spawn', { tier: 'approved', item: id, count: 1 }))), ...(P.has('items.spawn.any') ? fun.map(([id, l]) => btn(l, () => send('spawn', { tier: 'any', item: id, count: 1 }))) : []))));
  }
  if (P.has('players.kick')) {
    const others = room.players.filter((p) => p.cid !== myCid);
    parts.push(sec('Players', ...(others.length ? others.map((p) => el('div', { class: 'admrow' }, rankBadge(p.role), el('span', {}, p.displayName || p.username), p.role === 'DEVELOPER' ? el('span', { class: 'muted small' }, 'protected') : btn('Kick', () => send('kick', { cid: p.cid, reason: 'Removed by staff' }), 'danger'), P.has('teleport') ? btn('→ Cockpit', () => send('teleport', { cid: p.cid, to: 'cockpit' })) : null)) : [el('div', { class: 'muted small' }, 'No other players in the room.')])));
  }
  if (P.has('weather.change')) parts.push(sec('Weather', el('div', { class: 'admgrid' }, btn('☀ Clear', () => send('weather', { weather: 'clear' })), btn('⛈ Storm', () => send('weather', { weather: 'storm' })))));
  if (P.has('emergency.trigger')) {
    const sc = [['engine_failure', 'Engine failure'], ['turbulence', 'Severe turbulence'], ['cabin_pressure', 'Cabin pressure'], ['emergency_landing', 'Emergency landing']];
    parts.push(sec('Emergency scenarios', el('div', { class: 'admgrid' }, ...sc.map(([id, l]) => btn(l, () => send('emergency', { scenario: id, action: 'start' }), 'danger'))), P.has('emergency.manage') ? el('div', { class: 'admgrid' }, ...sc.map(([id, l]) => btn(`Stop ${l.toLowerCase()}`, () => send('emergency', { scenario: id, action: 'stop' })))) : null));
  }
  if (P.has('teleport')) parts.push(sec('Teleport (you)', el('div', { class: 'admgrid' }, ...['cockpit', 'cabin', 'cargo', 'apron'].map((s) => btn(s, () => send('teleport', { to: s }))))));
  if (P.has('npc.control')) parts.push(sec('Passengers (NPC control)', el('div', { class: 'admgrid' }, ...[['sit', '🪑 Sit all'], ['dance', '💃 Dance'], ['panic', '😱 Panic'], ['calm', '😌 Calm'], ['respawn', '🪂 Respawn lost passengers']].map(([a, l]) => btn(l, () => send('npc', { action: a }))))));
  if (P.has('items.spawn.developer')) parts.push(sec('Developer gear', el('div', { class: 'admgrid' }, btn('🌊 Equip Wave Cannon', () => send('gear', { item: 'wave_cannon' }), 'gold')), el('p', { class: 'muted small' }, 'Fictional splash cannon: with empty hands, click (or tap 💦) to blast loose luggage away.')));
  if (!parts.length) parts.push(el('p', { class: 'muted small' }, 'Your rank has no in-game staff tools.'));
  body.replaceChildren(...parts);
}

export const CREW_LABEL = { pilot: 'Pilot', copilot: 'Co-pilot', cabin: 'Cabin crew', cargo: 'Cargo' };
/** Glide-path indicator (PAPI lights + vertical/lateral deviation). */
export function glide(gp, { name, gearDown, show: vis, win = { high: 40, low: -30 } }) {
  const box = $('#gpath');
  if (!vis) return box.classList.add('hidden');
  box.classList.remove('hidden');
  $('#gpDest').textContent = name;
  const lights = box.querySelectorAll('.papi i');
  lights.forEach((l, i) => l.classList.toggle('w', i < gp.papi));
  const v = Math.max(-30, Math.min(30, -gp.dev / 6)); // metres above slope: dot moves up
  $('#gpV').style.top = `${30 + v}px`;
  const lat = Math.max(-72, Math.min(72, gp.lateral / 10)); // your position vs the centreline
  $('#gpL').style.left = `calc(50% + ${lat}px)`;
  const txt = gp.along < 0 ? 'Over the runway: flare!' : gp.dev > win.high ? 'Too high: descend' : gp.dev < win.low ? 'Too low: climb' : 'On the glide path';
  $('#gpTxt').textContent = `${(gp.along / 1000).toFixed(1)} km · ${txt}${Math.abs(gp.lateral) > 60 ? (gp.lateral > 0 ? ' · steer left' : ' · steer right') : ''}`;
  $('#gpGear').classList.toggle('hidden', gearDown || gp.h > 400);
}

/** Airline credits: ₵1,234 / −₵60 */
export function money(v, signed = false) { const n = Math.round(v); return `${n < 0 ? '−' : signed && n > 0 ? '+' : ''}₵${Math.abs(n).toLocaleString('en-US')}`; }
