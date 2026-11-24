import { api, h, getMe, fmtDay, safeUrl } from './common.js';
import { gameCard, coverOf, statusLabel, releaseLine, withBuiltins } from './ui.js';

const $id = (id) => document.getElementById(id);

function newsCard(p) {
  const cover = safeUrl(p.coverImage);
  return h('a', { class: 'card news-card', href: `/news/${encodeURIComponent(p.slug)}` },
    h('div', { class: cover ? 'thumb' : 'thumb is-mark' }, cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : h('img', { class: 'mark', src: '/img/batlas-mark.png', alt: '' })),
    h('div', { class: 'body' },
      h('div', { class: 'news-meta' }, p.pinned ? h('span', { class: 'pill pinned' }, 'Pinned') : null, h('span', {}, fmtDay(p.publishedAt))),
      h('h3', {}, p.title), p.summary ? h('p', { class: 'muted small m0' }, p.summary) : null));
}

const [gamesR, newsR, me] = await Promise.allSettled([api('GET', '/api/games'), api('GET', '/api/news?limit=3'), getMe()]);
const games = gamesR.status === 'fulfilled' ? gamesR.value.games : [];
// The catalog is whatever the studio has published. Until the studio lists its own games, Sky Crew ships on disk.
const listed = withBuiltins(games);

const pub = listed.filter((g) => g.status === 'published');
const feat = listed.find((g) => g.settings?.featured) || pub[0] || listed[0];
const count = $id('collection-count');
const two = String(listed.length).padStart(2, '0');
if (count) count.textContent = listed.length === 1 ? '01 game' : `${two} games`;
if ($id('fact-count')) $id('fact-count').textContent = two;

// Genre tag for the corner of each card.
const TAGS = { 'sky-crew': 'Co-op', highcrag: 'Survival' };
function collectionCard(g, i) {
  const cover = coverOf(g);
  const mark = !cover || /batlas-(logo|mark)/.test(cover);
  const play = safeUrl(g.playUrl);
  return h('article', { class: 'big-card' },
    h('a', { class: mark ? 'bc-media is-mark' : 'bc-media', href: `/games/${encodeURIComponent(g.slug)}`, 'aria-label': g.title },
      h('img', { src: cover || '/img/batlas-mark.png', alt: '', loading: 'lazy' }),
      h('span', { class: 'bc-no' }, `No. ${String(i + 1).padStart(2, '0')}`),
      h('span', { class: 'bc-tag' }, TAGS[g.slug] || statusLabel(g)),
      h('div', { class: 'bc-overlay' }, h('span', { class: `pill ${g.status}` }, statusLabel(g)), h('h3', {}, g.title))),
    h('div', { class: 'bc-body' },
      h('p', {}, g.tagline || ''),
      h('div', { class: 'bc-actions' },
        play && g.settings?.playEnabled !== false ? h('a', { class: 'btn primary go', href: play }, g.status === 'upcoming' ? 'Play early build' : 'Play') : null,
        h('a', { class: 'btn', href: `/games/${encodeURIComponent(g.slug)}`, id: i === 0 ? 'featured-details' : null }, 'Details'),
        releaseLine(g))));
}
const ordered = feat ? [feat, ...listed.filter((g) => g !== feat)] : listed;
$id('collection-grid').replaceChildren(...(ordered.length ? ordered.map(collectionCard) : [h('p', { class: 'empty-note' }, 'The hangar is quiet. New games will show up here.')]));

const heroPlay = $id('hero-play');
if (heroPlay) {
  if (feat && safeUrl(feat.playUrl) && feat.settings?.playEnabled !== false) {
    heroPlay.href = safeUrl(feat.playUrl);
    heroPlay.textContent = `Play ${feat.title}`;
  } else heroPlay.remove();
}

const posts = newsR.status === 'fulfilled' ? newsR.value.posts : [];
$id('news-list').replaceChildren(...(posts.length ? posts.map(newsCard) : [h('p', { class: 'empty-note' }, 'No announcements yet.')]));

if (me.status === 'fulfilled' && me.value.user) {
  $id('cta-band')?.remove();
  const j = $id('hero-join');
  if (j) { j.href = '/profile'; j.textContent = 'Your profile'; }
}
