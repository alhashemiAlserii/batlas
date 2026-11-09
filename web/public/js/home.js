import { api, h } from './common.js';
import { gameCard } from './ui.js';
const { games } = await api('GET', '/api/games');
const pub = games.filter((g) => g.status === 'published');
const up = games.filter((g) => g.status === 'upcoming');
const f = document.getElementById('featured');
f.replaceChildren(...(pub.length ? pub.slice(0, 6).map(gameCard) : [h('p', { class: 'muted' }, 'No games released yet. Stay tuned!')]));
const u = document.getElementById('upcoming');
u.replaceChildren(...(up.length ? up.map(gameCard) : [h('p', { class: 'muted' }, 'Nothing announced yet.')]));
import { newsItem } from './news-ui.js';
const nl = document.getElementById('news-list');
try {
  const { posts } = await api('GET', '/api/news?limit=3');
  nl.replaceChildren(...(posts.length ? posts.map(newsItem) : [h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No announcements yet. Check back soon!'))]));
} catch { nl.replaceChildren(); }
