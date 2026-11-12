// In-game staff / Developer panel (tabs). It only RENDERS controls from the permissions the server
// verified for this socket; every button sends a command that the game server re-checks.
import { el, rankBadge } from './ui.js';

const $ = (s) => document.querySelector(s);
const state = { tab: null, q: '', cat: 'All', bc: '', hour: 13, item: {} };

const WEATHER = [['clear', '☀ Clear'], ['cloudy', '☁ Cloudy'], ['rain', '🌧 Rain'], ['storm', '⛈ Storm'], ['fog', '🌫 Fog']];
const SCEN = [['engine_failure', 'Engine failure'], ['turbulence', 'Severe turbulence'], ['cabin_pressure', 'Cabin pressure'], ['emergency_landing', 'Emergency landing']];
const SPOTS = [['cockpit', '🧑‍✈️ Cockpit'], ['cargo', '📦 Cargo hold'], ['cabin', '💺 Cabin'], ['galley', '☕ Galley (rear)'], ['apron', '🛫 Apron']];

export function buildPanel({ you, room, myCid, send, live, inv, gear, flight, catalog = [] }) {
  const P = new Set(you.permissions || []);
  const dev = you.role === 'DEVELOPER';
  const btn = (label, fn, cls = '', extra = {}) => el('button', { type: 'button', class: cls, onclick: fn, ...extra }, label);
  const sec = (title, ...kids) => el('div', { class: 'admsec' }, el('h4', {}, title), ...kids);
  const grid = (...kids) => el('div', { class: 'admgrid' }, ...kids);
  const others = (room?.players || []).filter((p) => p.cid !== myCid);
  const tabs = [];
  const T = (id, label, ok, render) => { if (ok) tabs.push({ id, label, render }); };

  T('items', '🧳 Items', P.has('items.spawn.approved'), () => {
    const approved = [['suitcase', '🧳 Suitcase'], ['duffel', '👜 Duffel'], ['water', '💧 Water'], ['snack', '🍪 Snack'], ['blanket', '🛏 Blanket']];
    const fun = [['beach_ball', '🏐 Beach ball'], ['giant_duck', '🦆 Giant duck'], ['traffic_cone', '🚧 Cone']];
    return [sec('Approved items', grid(...approved.map(([id, l]) => btn(l, () => send('spawn', { tier: 'approved', item: id, count: 1 }), '', { 'data-item': id })))),
      P.has('items.spawn.any') ? sec('Any item', grid(...fun.map(([id, l]) => btn(l, () => send('spawn', { tier: 'any', item: id, count: 1 }), '', { 'data-item': id })))) : null];
  });
  // The secret inventory tab exists only after the server sent this socket the catalogue (verified Developer).
  T('inventory', '🔮 Inventory', dev && !!inv, () => {
    const q = state.q.toLowerCase();
    const cats = ['All', ...inv.categories];
    const search = el('input', { type: 'search', id: 'invSearch', placeholder: 'Search gadgets…', value: state.q, autocomplete: 'off' });
    search.addEventListener('input', () => { state.q = search.value; const pos = search.selectionStart; rerender(); const s2 = $('#invSearch'); s2?.focus(); s2?.setSelectionRange(pos, pos); });
    const items = inv.items.filter((i) => (state.cat === 'All' || i.category === state.cat) && (!q || `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(q)));
    return [
      el('p', { class: 'muted small' }, 'Developer-only. Fictional cartoon gadgets; every equip and use is checked and logged by the server.'),
      search,
      el('div', { class: 'invcats' }, ...cats.map((c) => btn(c, () => { state.cat = c; rerender(); }, c === state.cat ? 'on' : '', { 'data-cat': c }))),
      el('div', { class: 'invlist' }, ...(items.length ? items.map((i) => {
        const on = gear.has(i.id);
        return el('div', { class: `invcard${on ? ' on' : ''}`, 'data-gadget': i.id },
          el('div', { class: 'invicon' }, i.icon),
          el('div', { class: 'invtxt' }, el('b', {}, i.name), el('span', { class: 'muted small' }, `${i.category} · ${i.kind === 'tool' ? 'hand tool (click / 🔫)' : 'ability (always on)'}`), el('span', { class: 'small' }, i.description)),
          el('div', { class: 'invbtns' },
            i.kind === 'tool' ? btn('Spawn', () => send('spawn', { tier: 'developer', item: i.id, count: 1 }), '', { 'data-act': 'spawn' }) : null,
            on ? btn('Unequip', () => send('unequip', { item: i.id }), 'danger', { 'data-act': 'unequip' }) : btn('Equip', () => send('equip', { item: i.id }), 'gold', { 'data-act': 'equip' })));
      }) : [el('div', { class: 'muted small' }, 'Nothing matches.')])),
    ];
  });
  T('world', '🌦 World', P.has('weather.change') || P.has('environment.control'), () => {
    const out = [];
    if (P.has('weather.change')) out.push(sec(`Weather (now: ${room?.weather || 'clear'})`, grid(...WEATHER.map(([id, l]) => btn(l, () => send('weather', { weather: id }), room?.weather === id ? 'on' : '', { 'data-weather': id })))));
    if (P.has('environment.control')) {
      const lab = el('span', { class: 'muted small' }, fmtHour(room?.hour ?? state.hour));
      const r = el('input', { type: 'range', min: '0', max: '24', step: '0.25', value: String(room?.hour ?? state.hour), id: 'admHour' });
      r.addEventListener('input', () => { lab.textContent = fmtHour(Number(r.value)); });
      r.addEventListener('change', () => { state.hour = Number(r.value); send('time', { hour: state.hour }); });
      out.push(sec('Time of day', el('div', { class: 'admrow' }, r, lab), grid(...[[6, '🌅 Dawn'], [13, '🌞 Noon'], [18.5, '🌇 Sunset'], [23, '🌙 Night']].map(([h, l]) => btn(l, () => { state.hour = h; send('time', { hour: h }); })))));
    }
    return out;
  });
  T('emerg', '🚨 Emergencies', P.has('emergency.trigger'), () => [sec('Start a scenario', grid(...SCEN.map(([id, l]) => btn(l, () => send('emergency', { scenario: id, action: 'start' }), 'danger', { 'data-scenario': id })))),
    P.has('emergency.manage') ? sec('Stop', grid(...SCEN.map(([id, l]) => btn(`Stop ${l.toLowerCase()}`, () => send('emergency', { scenario: id, action: 'stop' }))))) : null]);
  T('players', '👥 Players', P.has('players.kick') || P.has('teleport') || P.has('dev.commands'), () => [sec(`Players in ${room?.code || 'room'}`, ...(others.length ? others.map((p) => {
    const prot = p.role === 'DEVELOPER';
    const canMod = !prot && rankAbove(you.role, p.role);
    return el('div', { class: 'admplayer', 'data-player': p.username },
      el('div', { class: 'admrow' }, rankBadge(p.role), el('span', {}, `${p.displayName || p.username}${p.frozen ? ' 🧊' : ''}${p.muted ? ' 🔇' : ''}`), prot ? el('span', { class: 'muted small' }, 'protected') : null),
      grid(
        canMod && P.has('players.kick') ? btn('Kick', () => send('kick', { cid: p.cid, reason: 'Removed by staff' }), 'danger', { 'data-act': 'kick' }) : null,
        canMod && P.has('players.ban') ? btn('Ban 1 h', () => send('ban', { cid: p.cid, minutes: 60, reason: 'Banned by staff' }), 'danger', { 'data-act': 'ban' }) : null,
        canMod && P.has('players.ban') && dev ? btn('Ban account', () => { if (confirm(`Ban the account ${p.username} on the whole website?`)) send('ban', { cid: p.cid, scope: 'site', reason: 'Banned in Sky Crew' }); }, 'danger', { 'data-act': 'siteban' }) : null,
        canMod && P.has('players.kick') ? btn(p.muted ? 'Unmute' : 'Mute 10 min', () => send('mute', { cid: p.cid, minutes: 10, on: !p.muted }), '', { 'data-act': 'mute' }) : null,
        canMod && P.has('dev.commands') ? btn(p.frozen ? 'Unfreeze' : 'Freeze', () => send('freeze', { cid: p.cid, on: !p.frozen }), '', { 'data-act': 'freeze' }) : null,
        P.has('teleport') ? btn('Go to', () => send('teleport', { toPlayer: p.cid }), '', { 'data-act': 'goto' }) : null,
        P.has('teleport') && !prot ? btn('Bring', () => send('teleport', { bring: p.cid }), '', { 'data-act': 'bring' }) : null));
  }) : [el('div', { class: 'muted small' }, 'No other players in the room.')]))]);
  T('wallet', '💳 Wallet', dev && P.has('dev.commands'), () => [sec('Credits & shop items (Developer only, logged)', ...((room?.players || []).map((p) => {
    const sel = el('select', { 'data-wallet-item': p.username }, ...catalog.filter((i) => i.price > 0).map((i) => el('option', { value: i.key }, `${i.name} (${i.kind})`)));
    if (state.item[p.cid]) sel.value = state.item[p.cid];
    sel.addEventListener('change', () => { state.item[p.cid] = sel.value; });
    return el('div', { class: 'admplayer', 'data-wallet': p.username },
      el('div', { class: 'admrow' }, rankBadge(p.role), el('span', {}, `${p.displayName || p.username}${p.cid === myCid ? ' (you)' : ''}`), p.role === 'DEVELOPER' ? el('span', { class: 'muted small' }, 'owns everything') : null),
      grid(...[100, 500, 1000].map((n) => btn(`+₵${n}`, () => send('wallet', { cid: p.cid, credits: n }), 'gold', { 'data-credits': String(n) })), btn('−₵500', () => send('wallet', { cid: p.cid, credits: -500 }), 'danger', { 'data-credits': '-500' })),
      el('div', { class: 'setrow' }, sel, btn('Give', () => send('wallet', { cid: p.cid, item: sel.value }), '', { 'data-act': 'give' }), btn('Take away', () => send('wallet', { cid: p.cid, item: sel.value, remove: true }), 'danger', { 'data-act': 'take' })));
  })))]);
  T('teleport', '🌀 Teleport', P.has('teleport'), () => [sec('Teleport me to', grid(...SPOTS.map(([id, l]) => btn(l, () => send('teleport', { to: id }), '', { 'data-spot': id })))),
    others.length ? sec('Teleport me to a player', grid(...others.map((p) => btn(p.displayName || p.username, () => send('teleport', { toPlayer: p.cid }))))) : null]);
  T('npc', '🧍 NPCs', P.has('npc.control'), () => [sec(`Passengers (${flight?.pax ?? '?'} aboard)`, grid(
    btn('➕ Spawn passenger', () => send('npc', { action: 'spawn', count: 1 }), '', { 'data-npc': 'spawn' }), btn('➕ ×4', () => send('npc', { action: 'spawn', count: 4 })), btn('➖ Remove one', () => send('npc', { action: 'remove', count: 1 }), '', { 'data-npc': 'remove' }),
    btn('😌 Calm all', () => send('npc', { action: 'calm' }), '', { 'data-npc': 'calm' }), btn('😱 Panic all', () => send('npc', { action: 'panic' }), 'danger', { 'data-npc': 'panic' }),
    btn('🧊 Freeze all', () => send('npc', { action: 'freeze' }), '', { 'data-npc': 'freeze' }), btn('Unfreeze', () => send('npc', { action: 'unfreeze' })),
    btn('🪑 Sit all', () => send('npc', { action: 'sit' })), btn('💃 Dance', () => send('npc', { action: 'dance' })), btn('🪂 Respawn lost', () => send('npc', { action: 'respawn' }))))]);
  T('events', '🎉 Events', P.has('events.control'), () => [sec('Start an event', grid(btn('🌪 Turbulence', () => send('event', { event: 'turbulence' }), '', { 'data-event': 'turbulence' }), btn('🎂 Birthday party', () => send('event', { event: 'birthday' }), '', { 'data-event': 'birthday' }), btn('⭐ VIP passenger', () => send('event', { event: 'vip' }), '', { 'data-event': 'vip' })))]);
  T('config', '⚙ Config', P.has('games.manage'), () => {
    const c = room?.config || { difficulty: 'normal', payout: 1, maxPlayers: 8 };
    const sel = el('select', { id: 'cfgDiff' }, ...['easy', 'normal', 'hard'].map((d) => { const o = el('option', { value: d }, d); if (d === c.difficulty) o.selected = true; return o; }));
    const pay = el('input', { type: 'number', id: 'cfgPay', min: '0.5', max: '3', step: '0.25', value: String(c.payout) });
    const max = el('input', { type: 'number', id: 'cfgMax', min: '1', max: '8', step: '1', value: String(c.maxPlayers) });
    return [sec('Room game config', el('label', { class: 'setrow' }, 'Difficulty ', sel), el('label', { class: 'setrow' }, 'Payout multiplier ', pay), el('label', { class: 'setrow' }, 'Max players ', max),
      grid(btn('Apply', () => send('config', { difficulty: sel.value, payout: Number(pay.value), maxPlayers: Number(max.value) }), 'gold', { id: 'cfgApply' })),
      el('p', { class: 'muted small' }, 'Difficulty changes how fast passengers get annoyed and how often events happen. The multiplier shows as its own payout line.'))];
  });
  T('server', '🖥 Server', dev, () => {
    const hid = el('input', { type: 'checkbox', id: 'admHidden' }); hid.checked = !!live?.hidden;
    hid.addEventListener('change', () => { if (live) live.hidden = hid.checked; });
    const rows = (live?.rooms || []).map((r) => el('div', { class: 'admrow', 'data-room': r.code }, el('span', {}, `${r.code}${r.locked ? ' 🔒' : ''} · ${r.host || '?'} · ${r.count}/${r.max} · ${r.route || '—'} · ${r.phase || 'lobby'}`),
      r.code === room?.code ? el('span', { class: 'muted small' }, 'here') : btn('Join', () => live.join(r.code, hid.checked), 'gold'),
      btn('Close', () => { if (confirm(`Close room ${r.code} and remove its ${r.count} player(s)?`)) send('close_room', { code: r.code }).then?.(() => live.refresh()); }, 'danger', { 'data-act': 'close' })));
    const msg = el('input', { type: 'text', id: 'bcText', maxlength: '200', placeholder: 'Message to every player online', value: state.bc });
    msg.addEventListener('input', () => { state.bc = msg.value; });
    return [sec('Live rooms', grid(btn('↻ Refresh', () => live?.refresh())), el('label', { class: 'admrow' }, hid, el('span', {}, 'Join hidden (invisible spectator)')), ...(rows.length ? rows : [el('div', { class: 'muted small' }, live?.rooms ? 'No live rooms.' : 'Press refresh.')])),
      sec('Broadcast', msg, grid(btn('📣 Send to everyone', () => { if (msg.value.trim()) { send('broadcast', { text: msg.value.trim() }); state.bc = ''; msg.value = ''; } }, 'gold', { id: 'bcSend' })))];
  });

  const head = $('#admTabs'), body = $('#admBody');
  $('#admRank').replaceChildren(rankBadge(you.role));
  $('#admTitle').textContent = dev ? 'Developer panel' : 'Staff tools';
  if (!room && !dev) { head.replaceChildren(); body.replaceChildren(el('p', { class: 'muted small' }, 'Staff tools work in a co-op room (so the game server can verify your rank). Create a room from the menu.')); return; }
  const visible = room ? tabs : tabs.filter((t) => t.id === 'server');
  if (!visible.length) { head.replaceChildren(); body.replaceChildren(el('p', { class: 'muted small' }, 'Your rank has no in-game staff tools.')); return; }
  if (!visible.some((t) => t.id === state.tab)) state.tab = visible[0].id;
  head.replaceChildren(...visible.map((t) => btn(t.label, () => { state.tab = t.id; rerender(); }, t.id === state.tab ? 'on' : '', { 'data-tab': t.id, role: 'tab', 'aria-selected': String(t.id === state.tab) })));
  body.replaceChildren(...[].concat(visible.find((t) => t.id === state.tab).render()).filter(Boolean));
  function rerender() { buildPanel({ you, room, myCid, send, live, inv, gear, flight, catalog }); }
}
const LV = { PLAYER: 0, TRUSTED: 1, ADMIN: 2, DEVELOPER: 3 };
const rankAbove = (a, b) => (LV[a] ?? 0) > (LV[b] ?? 0);
function fmtHour(h) { const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
export const panelState = state;
