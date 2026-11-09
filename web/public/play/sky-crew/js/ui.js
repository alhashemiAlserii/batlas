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

let lastObj = '';
export function objectives(title, rows) {
  const key = title + JSON.stringify(rows);
  if (key === lastObj) return; lastObj = key;
  $('#obj').replaceChildren(el('h3', {}, title), ...rows.map((r) => el('div', { class: `o ${r.state || ''}` }, r.state === 'done' ? '✔' : r.state === 'warn' ? '⚠' : '•', ' ', r.text)));
}
let lastPrompt = null;
export function prompt(text) {
  if (text === lastPrompt) return; lastPrompt = text;
  const p = $('#prompt');
  if (!text) return p.classList.add('hidden');
  p.replaceChildren(el('kbd', {}, document.body.classList.contains('touch') ? 'E' : 'E'), text);
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
  show('#results', true);
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
export function glide(gp, { name, gearDown, show: vis }) {
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
  const txt = gp.along < 0 ? 'Over the runway: flare!' : gp.dev > 40 ? 'Too high: descend' : gp.dev < -30 ? 'Too low: climb' : 'On the glide path';
  $('#gpTxt').textContent = `${(gp.along / 1000).toFixed(1)} km · ${txt}${Math.abs(gp.lateral) > 60 ? (gp.lateral > 0 ? ' · steer left' : ' · steer right') : ''}`;
  $('#gpGear').classList.toggle('hidden', gearDown || gp.h > 400);
}

/** Airline credits: ₵1,234 / −₵60 */
export function money(v, signed = false) { const n = Math.round(v); return `${n < 0 ? '−' : signed && n > 0 ? '+' : ''}₵${Math.abs(n).toLocaleString('en-US')}`; }
