import { api, h } from './common.js';
import { newsItem } from './news-ui.js';
const list = document.getElementById('list');
const { posts } = await api('GET', '/api/news?limit=50');
list.replaceChildren(...(posts.length ? posts.map(newsItem) : [h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No announcements yet.'))]));
