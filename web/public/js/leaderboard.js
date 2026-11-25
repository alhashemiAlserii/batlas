import { api, h, getMe } from './common.js';

const rewards = [
  ['01', 'First place', 'A preview pass for the next test build. Staff grant it by hand after the week closes.'],
  ['02', 'Second place', 'A crew card, also granted by staff. It shows on your passes. It does not unlock a locked game.'],
  ['03', 'Third place', 'A note on the studio board. Same rule: a person grants it. No checkout, no price.'],
];
document.getElementById('reward-row').replaceChildren(...rewards.map(([n, t, d]) =>
  h('article', { class: 'reward' }, h('span', { class: 'idx' }, n), h('h2', {}, t), h('p', {}, d))));

function tick(iso) {
  const ms = Date.parse(iso) - Date.now();
  const el = document.getElementById('week-clock');
  if (!(ms > 0)) { el.textContent = 'The week just reset.'; return; }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hhh = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  el.textContent = `Resets in ${d}d ${hhh}h ${m}m`;
}

const me = await getMe().catch(() => ({ user: null }));
if (!me.user) {
  document.getElementById('compete').replaceChildren(
    h('div', { class: 'compete' }, h('p', {}, 'Sign in to compete'), h('a', { class: 'btn primary', href: '/login?next=/leaderboard' }, 'Sign in')));
}

try {
  const data = await api('GET', '/api/games/sky-crew/weekly');
  tick(data.resetsAt);
  setInterval(() => tick(data.resetsAt), 30000);
  const board = document.getElementById('board');
  if (!data.rows.length) {
    board.replaceChildren(h('p', { class: 'muted' }, 'No flights logged this week. Finish a Sky Crew hop while signed in and your handle lands here. Stars and landings still live on your profile.'));
  } else {
    board.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Rank'), h('th', {}, 'Handle'), h('th', {}, 'Flights this week'))),
      h('tbody', {}, data.rows.map((r) => h('tr', {},
        h('td', {}, String(r.rank)),
        h('td', {}, h('a', { href: `/u/${encodeURIComponent(r.handle)}`, class: `name-${(r.role || 'player').toLowerCase()}` }, r.handle)),
        h('td', {}, String(r.flights))))))));
  }
} catch {
  document.getElementById('board').replaceChildren(h('p', { class: 'muted' }, 'The board is quiet right now. Try again in a minute.'));
}
