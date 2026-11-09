import { api, h } from './common.js';
import { gameCard } from './ui.js';
const { games } = await api('GET', '/api/games');
const list = document.getElementById('list');
function render(f) {
  const g = f === 'all' ? games : games.filter((x) => x.status === f);
  list.replaceChildren(...(g.length ? g.map(gameCard) : [h('p', { class: 'muted' }, 'No games here yet.')]));
}
document.getElementById('filters').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#filters button').forEach((x) => x.classList.toggle('active', x === b));
  render(b.dataset.f);
});
render('all');
