import { h, fmtDay, timeUntil, safeUrl } from './common.js';

export const statusLabel = (g) => (g.status === 'upcoming' ? 'Coming soon' : g.status === 'published' ? 'Out now' : g.status);
export const coverOf = (g) => safeUrl(g.coverImage) || safeUrl(g.trailerPoster) || safeUrl(g.screenshots?.[0]) || '';
const markArt = (url) => !url || /batlas-(logo|mark)/.test(url);

/** Shipped with the site. Used when the studio catalog has not been filled in yet. */
export const builtinSkyCrew = {
  slug: 'sky-crew',
  title: 'Sky Crew',
  status: 'published',
  version: '0.4',
  tagline: 'Load the bags, board the passengers, keep everyone calm, and land with your friends.',
  description: 'Sky Crew is a co-op cabin game you play in the browser. Pick up bags, board passengers, take a crew seat, and fly together. One Batlas handle and a 4–6 digit PIN is the whole account. No email.',
  playUrl: '/play/sky-crew',
  coverImage: '/img/batlas-logo-640.jpg',
  platforms: ['Browser', 'Up to 8 players'],
  screenshots: [],
  settings: { playEnabled: true, showLeaderboard: true, featured: true },
};

export function releaseLine(g) {
  if (g.status !== 'upcoming') return null;
  if (!g.releaseDate) return h('span', { class: 'release' }, 'Release date TBA');
  const until = timeUntil(g.releaseDate + 'T00:00:00');
  return h('span', { class: 'release' }, fmtDay(g.releaseDate), until ? h('span', { class: 'countdown muted' }, ` · ${until}`) : null);
}

export function gameCard(g) {
  const cover = coverOf(g);
  const mark = markArt(cover);
  return h('a', { class: 'card game-card', href: `/games/${encodeURIComponent(g.slug)}` },
    h('div', { class: mark ? 'cover is-mark' : 'cover' },
      cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : h('img', { src: '/img/batlas-mark.png', alt: '' }),
      h('div', { class: 'cover-copy' },
        h('span', { class: `pill ${g.status}` }, statusLabel(g)),
        h('strong', { class: 'cover-title' }, g.title))),
    h('div', { class: 'body' },
      h('div', { class: 'cap-row' }, h('h3', {}, g.title), h('span', { class: 'open-cue' }, 'Open')),
      h('p', { class: 'muted small m0' }, g.tagline || ''),
      h('div', { class: 'meta' }, releaseLine(g))));
}
