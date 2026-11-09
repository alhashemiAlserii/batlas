import { api, h } from './common.js';
import { gameCard } from './ui.js';
const { games } = await api('GET', '/api/games');
const pub = games.filter((g) => g.status === 'published');
const up = games.filter((g) => g.status === 'upcoming');
const f = document.getElementById('featured');
f.replaceChildren(...(pub.length ? pub.slice(0, 6).map(gameCard) : [h('p', { class: 'muted' }, 'No games released yet. Stay tuned!')]));
const u = document.getElementById('upcoming');
u.replaceChildren(...(up.length ? up.map(gameCard) : [h('p', { class: 'muted' }, 'Nothing announced yet.')]));
