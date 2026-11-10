import { h, fmtDay, timeUntil, safeUrl } from './common.js';

export const statusLabel = (g) => (g.status === 'upcoming' ? 'Coming soon' : g.status === 'published' ? 'Out now' : g.status);
export const coverOf = (g) => safeUrl(g.coverImage) || safeUrl(g.trailerPoster) || safeUrl(g.screenshots?.[0]) || '';

export function releaseLine(g) {
  if (g.status !== 'upcoming') return null;
  if (!g.releaseDate) return h('span', { class: 'release' }, 'Release date TBA');
  const until = timeUntil(g.releaseDate + 'T00:00:00');
  return h('span', { class: 'release' }, '📅 ', fmtDay(g.releaseDate), until ? h('span', { class: 'countdown muted' }, ` · ${until}`) : null);
}

export function gameCard(g) {
  const cover = coverOf(g);
  return h('a', { class: 'card game-card', href: `/games/${encodeURIComponent(g.slug)}` },
    h('div', { class: 'cover' }, cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : '✈'),
    h('div', { class: 'body' },
      h('div', { class: 'meta' }, h('span', { class: `pill ${g.status}` }, statusLabel(g)), releaseLine(g)),
      h('h3', {}, g.title), h('p', { class: 'muted small' }, g.tagline || '')));
}
