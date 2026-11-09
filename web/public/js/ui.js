import { h } from './common.js';
export function gameCard(g) {
  return h('a', { class: 'card game-card', href: `/games/${encodeURIComponent(g.slug)}` },
    h('div', { class: 'cover' }, g.coverImage ? h('img', { src: g.coverImage, alt: '', loading: 'lazy' }) : '✈'),
    h('div', { class: 'body' },
      h('span', { class: `pill ${g.status}` }, g.status === 'upcoming' ? 'Coming soon' : g.status === 'published' ? 'Out now' : g.status),
      h('h3', {}, g.title), h('p', { class: 'muted small' }, g.tagline || '')));
}
