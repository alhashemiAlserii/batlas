import { api, h, getMe, rankBadge, avatar, showError, showOk, fmtDate } from './common.js';
const root = document.getElementById('profile');
const parts = location.pathname.split('/');
let me = { user: null, permissions: new Set() };
try { me = await getMe(); } catch { /* network aborted; treat as logged out */ }
let username = parts[1] === 'u' ? decodeURIComponent(parts[2] || '') : me.user?.username;
if (!username) { location.href = '/login?next=/profile'; }
else {
  try {
    const { user } = await api('GET', `/api/users/${encodeURIComponent(username)}`);
    const mine = me.user && me.user.id === user.id;
    const role = user.role.toLowerCase();
    root.replaceChildren(
      h('div', { class: `card panel-${role === 'developer' ? 'dev' : role}` },
        h('div', { class: 'profile-head' }, avatar(user, 'lg'), h('div', {}, h('div', { class: 'panel-head' }, h('h1', { class: `name-${role}` }, user.displayName), rankBadge(user.role)),
        h('p', { class: 'muted' }, '@', user.username, ' · joined ', fmtDate(user.createdAt)))),
        user.banned ? h('div', { class: 'alert error' }, 'This account is banned.') : null,
        h('p', { class: 'desc' }, user.bio || (mine ? 'You have not written a bio yet.' : ''))),
    );
    try {
      const { skyCrew: st } = await api('GET', `/api/users/${encodeURIComponent(username)}/game-stats`);
      const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, String(n)), h('div', { class: 'l' }, l));
      root.append(h('section', { class: 'game-stats' },
        h('div', { class: 'section-head' }, h('h2', {}, 'Sky Crew stats'), h('a', { class: 'small', href: '/games/sky-crew' }, 'Leaderboard →')),
        st.flights ? h('div', { class: 'stat-grid' }, stat(st.flights, 'Flights'), stat(st.bestScore == null ? '—' : `₵${st.bestScore.toLocaleString('en-US')}`, 'Best payout'), stat(st.landings, 'Safe landings'), stat(st.butterLandings, 'Butter landings'), stat(st.crashes, 'Crashes'))
          : h('p', { class: 'muted' }, mine ? 'No flights yet. ' : 'No flights yet.', mine ? h('a', { href: '/play/sky-crew' }, 'Play Sky Crew') : null)));
    } catch { /* stats are optional */ }
    if (mine) {
      const msg = h('div', { 'aria-live': 'polite' });
      const form = h('form', { class: 'card', novalidate: true },
        h('h2', {}, 'Edit profile'),
        h('div', { class: 'field' }, h('label', { for: 'dn' }, 'Display name'), h('input', { id: 'dn', name: 'displayName', maxlength: 40, value: user.displayName })),
        h('div', { class: 'field' }, h('label', { for: 'bio' }, 'Bio'), (() => { const t = h('textarea', { id: 'bio', name: 'bio', maxlength: 500 }); t.value = user.bio; return t; })()),
        h('p', { class: 'small muted' }, me.user.email ? ['Email: ', me.user.email, ' (private) · '] : 'No email (optional) · ', h('a', { href: '/settings' }, 'Avatar, password & email settings')),
        msg, h('button', { class: 'btn primary' }, 'Save'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('PATCH', '/api/me', Object.fromEntries(new FormData(form))); showOk(msg, 'Saved.'); setTimeout(() => location.reload(), 600); }
        catch (err) { showError(msg, err); }
      });
      root.append(h('div', { class: 'section-head' }), form);
    }
  } catch (e) {
    root.replaceChildren(h('div', { class: 'card center-box' }, h('h1', {}, 'Player not found')));
  }
}
