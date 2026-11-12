import { api, h, fmtDay, userChip } from './common.js';
const root = document.getElementById('post');
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
try {
  const { post: p } = await api('GET', `/api/news/${encodeURIComponent(slug)}`);
  document.title = `${p.title} · Batlas`;
  const img = /^(https?:\/\/|\/)/.test(p.coverImage) ? p.coverImage : '';
  root.replaceChildren(...[
    h('a', { href: '/news', class: 'back-link' }, '← All news'),
    h('h1', {}, p.title),
    h('div', { class: 'news-meta' }, p.pinned ? h('span', { class: 'pill pinned' }, 'Pinned') : null, h('span', {}, fmtDay(p.publishedAt)), p.author ? userChip(p.author) : null),
    img ? h('div', { class: 'cover' }, h('img', { src: img, alt: '' })) : null,
    p.summary ? h('p', { class: 'muted' }, p.summary) : null,
    h('div', { class: 'body' }, p.body)].filter(Boolean));
} catch {
  root.replaceChildren(h('div', { class: 'card center-box' }, h('h1', {}, 'Post not found'), h('a', { class: 'btn', href: '/news' }, 'Back to news')));
}
