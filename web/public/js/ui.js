import { h, fmtDay, timeUntil, safeUrl } from './common.js';

export const statusLabel = (g) => (g.status === 'upcoming' ? 'Coming soon' : g.status === 'published' ? 'Out now' : g.status);
/** Official Sky Crew cover. The studio wave stays the site mark; this photo is the game's. */
export const SKY_CREW_COVER = '/img/sky-crew-cover.jpg';
const MARK = /batlas-(logo|mark)/;
export const coverOf = (g) => {
  const c = safeUrl(g?.coverImage) || safeUrl(g?.trailerPoster) || safeUrl(g?.screenshots?.[0]) || '';
  // A fresh catalog (or one still pointing at the studio wave) should show the game's own cover.
  if (g?.slug === 'sky-crew' && (!c || MARK.test(c))) return SKY_CREW_COVER;
  return c;
};
const markArt = (url) => !url || MARK.test(url);

/** Shipped with the site. Used when the studio catalog has not been filled in yet. */
export const builtinSkyCrew = {
  slug: 'sky-crew',
  title: 'Sky Crew',
  status: 'published',
  version: '0.4',
  tagline: 'Load the bags, board the passengers, keep everyone calm, and land with your friends.',
  description: 'Sky Crew is a co-op cabin game you play in the browser. Pick up bags, board passengers, take a crew seat, and fly together. One Batlas handle and a 4–6 digit PIN is the whole account. No email.',
  playUrl: '/play/sky-crew',
  coverImage: '/img/sky-crew-cover.jpg',
  platforms: ['Browser', 'Up to 8 players'],
  screenshots: [],
  settings: { playEnabled: true, showLeaderboard: true, featured: true },
};

/** Games the site lists by itself (server/src/lib/seed-games.ts); they are not the studio filling in its catalog. */
const AUTO_LISTED = new Set(['highcrag']);
/** The public list: the studio's catalog, plus the shipped Sky Crew until the studio lists its own games. */
export function withBuiltins(catalog) {
  if (catalog.some((g) => g.slug === 'sky-crew' || !AUTO_LISTED.has(g.slug))) return catalog;
  return [builtinSkyCrew, ...catalog];
}

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
