// Shared staff UI pieces (admin panel + developer dashboard).
// These only decide what to SHOW. Every action is re-validated by the server.
import { api, h, rankBadge, userChip, showError, showOk, fmtDate } from './common.js';

export const LEVEL = { PLAYER: 0, TRUSTED: 1, ADMIN: 2, DEVELOPER: 3 };
export const WEATHER = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];
export const EMERGENCIES = ['engine_failure', 'turbulence', 'weather_emergency', 'cabin_pressure', 'emergency_landing', 'evacuation', 'system_failure'];
const label = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** UX mirror of the server's canActOn(); server is authoritative. */
export const canActOn = (me, t) => t.role !== 'DEVELOPER' && me.id !== t.id && LEVEL[me.role] > LEVEL[t.role];

export function usersPanel(me, perms, { roles = false } = {}) {
  const msg = h('div', { 'aria-live': 'polite' });
  const q = h('input', { type: 'search', placeholder: 'Search username or email', 'aria-label': 'Search players' });
  const roleF = h('select', { 'aria-label': 'Filter by rank' }, h('option', { value: '' }, 'All ranks'), ...Object.keys(LEVEL).map((r) => h('option', { value: r }, r)));
  const count = h('span', { class: 'muted small' });
  const tbody = h('tbody');
  async function load() {
    try {
      const d = await api('GET', `/api/admin/users?q=${encodeURIComponent(q.value)}&role=${roleF.value}`);
      count.textContent = `${d.total} shown · ${d.activeSessions} with active sessions`;
      tbody.replaceChildren(...d.users.map(row));
    } catch (e) { showError(msg, e); }
  }
  async function act(fn, okMsg) {
    try { await fn(); showOk(msg, okMsg); load(); } catch (e) { showError(msg, e); }
  }
  function row(u) {
    const actions = h('div', { class: 'row-actions' });
    const actionable = canActOn(me, u);
    if (actionable && perms.has('players.kick')) actions.append(h('button', { class: 'btn small', onclick: () => { const r = prompt(`Kick ${u.username}? Reason (optional):`); if (r !== null) act(() => api('POST', `/api/admin/users/${u.id}/kick`, { reason: r || undefined }), `${u.username} kicked.`); } }, 'Kick'));
    if (actionable && perms.has('players.ban')) {
      if (u.banned) actions.append(h('button', { class: 'btn small', onclick: () => act(() => api('POST', `/api/admin/users/${u.id}/unban`), `${u.username} unbanned.`) }, 'Unban'));
      else actions.append(h('button', { class: 'btn small danger', onclick: () => { const r = prompt(`Ban ${u.username}? Reason:`); if (r !== null) act(() => api('POST', `/api/admin/users/${u.id}/ban`, { reason: r || undefined }), `${u.username} banned.`); } }, 'Ban'));
    }
    if (roles && actionable) {
      const assignable = ['PLAYER', 'TRUSTED', 'ADMIN', 'DEVELOPER'].filter((r) => r === 'PLAYER' || perms.has(`roles.grant.${r.toLowerCase()}`));
      const sel = h('select', { 'aria-label': `Rank for ${u.username}` }, ...assignable.map((r) => h('option', { value: r, selected: r === u.role }, r)));
      sel.addEventListener('change', () => {
        const role = sel.value;
        let confirmPassword;
        if (role === 'DEVELOPER') {
          if (!confirm(`Grant DEVELOPER (owner-level) to ${u.username}? They will have full control and cannot be removed via the website.`)) { sel.value = u.role; return; }
          confirmPassword = prompt('Re-enter your password to confirm:');
          if (!confirmPassword) { sel.value = u.role; return; }
        }
        act(() => api('PUT', `/api/admin/users/${u.id}/role`, { role, confirmPassword }), `${u.username} is now ${role}.`);
      });
      actions.prepend(sel);
    }
    if (!actions.childElementCount) actions.append(h('span', { class: 'muted small' }, u.role === 'DEVELOPER' ? 'Protected' : '—'));
    return h('tr', {},
      h('td', {}, userChip(u)),
      h('td', { class: 'small' }, u.email),
      h('td', {}, u.banned ? h('span', { class: 'pill', title: u.banReason || '' }, 'Banned') : h('span', { class: 'pill published' }, 'Active')),
      h('td', { class: 'small muted' }, fmtDate(u.lastLoginAt) || 'never'),
      h('td', {}, actions));
  }
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  roleF.addEventListener('change', load);
  load();
  return h('section', { class: 'card' },
    h('h2', {}, 'Players'),
    h('div', { class: 'inline' }, q, roleF, count), msg,
    h('div', { class: 'table-wrap section-head' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Player', 'Email', 'Status', 'Last login', 'Actions'].map((c) => h('th', {}, c)))), tbody)));
}

export function logPanel(title, url, { categories = null } = {}) {
  const tbody = h('tbody');
  const msg = h('div');
  const cat = categories ? h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'), ...categories.map((c) => h('option', { value: c }, c))) : null;
  async function load() {
    try {
      const d = await api('GET', url + (cat?.value ? `?category=${cat.value}` : ''));
      tbody.replaceChildren(...(d.entries.length ? d.entries.map((e) => h('tr', {},
        h('td', { class: 'small muted' }, fmtDate(e.createdAt)),
        h('td', {}, e.actor || 'system', ' ', e.actorRole && e.actorRole !== 'SYSTEM' ? rankBadge(e.actorRole) : ''),
        h('td', {}, h('code', {}, e.action)),
        h('td', {}, e.target || e.targetId || ''),
        h('td', { class: 'small muted' }, e.details ? JSON.stringify(e.details) : ''))) : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No entries yet.'))]));
    } catch (e) { showError(msg, e); }
  }
  cat?.addEventListener('change', load);
  load();
  return h('section', { class: 'card' }, h('div', { class: 'panel-head' }, h('h2', {}, title), cat, h('button', { class: 'btn small', onclick: load }, 'Refresh')), msg,
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['When', 'Actor', 'Action', 'Target', 'Details'].map((c) => h('th', {}, c)))), tbody)));
}

/** Game control stubs (/api/game/*). Each card appears only if the rank has the permission. */
export function gameControls(perms) {
  const msg = h('div', { 'aria-live': 'polite' });
  const run = async (url, body) => { try { const r = await api('POST', url, body); showOk(msg, `Accepted and logged. ${r.note || ''}`); } catch (e) { showError(msg, e); } };
  const cards = [];
  if (perms.has('weather.change')) {
    const s = h('select', { 'aria-label': 'Weather' }, ...WEATHER.map((w) => h('option', { value: w }, label(w))));
    cards.push(h('div', { class: 'card' }, h('h3', {}, '🌦 Weather'), h('div', { class: 'inline' }, s, h('button', { class: 'btn', onclick: () => run('/api/game/weather', { weather: s.value }) }, 'Apply'))));
  }
  if (perms.has('emergency.trigger')) {
    const s = h('select', { 'aria-label': 'Emergency scenario' }, ...EMERGENCIES.map((w) => h('option', { value: w }, label(w))));
    cards.push(h('div', { class: 'card' }, h('h3', {}, '🚨 Plane emergencies'), h('p', { class: 'small muted' }, 'Fictional in-game scenarios.'), h('div', { class: 'inline' }, s,
      h('button', { class: 'btn danger', onclick: () => run('/api/game/emergency', { scenario: s.value, action: 'start' }) }, 'Trigger'),
      perms.has('emergency.manage') ? h('button', { class: 'btn', onclick: () => run('/api/game/emergency', { scenario: s.value, action: 'stop' }) }, 'Stop') : null)));
  }
  if (perms.has('items.spawn.approved')) {
    const item = h('input', { placeholder: 'Item id, e.g. snack_cart', 'aria-label': 'Item id' });
    const tiers = [['approved', 'Approved items'], ['any', 'Any item'], ['developer', 'Developer exclusive']].filter(([t]) => perms.has(`items.spawn.${t}`));
    const tier = h('select', { 'aria-label': 'Item tier' }, ...tiers.map(([v, l]) => h('option', { value: v }, l)));
    cards.push(h('div', { class: 'card' }, h('h3', {}, '📦 Spawn items'), h('div', { class: 'inline' }, item, tiers.length > 1 ? tier : null,
      h('button', { class: 'btn', onclick: () => item.value.trim() && run('/api/game/spawn', { item: item.value.trim(), tier: tier.value || 'approved' }) }, 'Spawn'))));
  }
  if (!cards.length) return null;
  return h('section', {}, h('h2', {}, 'Game controls'), h('p', { class: 'small muted' }, 'These connect to live game sessions once the airplane game is online. For now each request is permission-checked and recorded in the audit log.'), msg, h('div', { class: 'controls' }, cards));
}
