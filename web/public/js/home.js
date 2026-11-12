import { api, h, getMe, fmtDay, safeUrl } from './common.js';
import { gameCard, coverOf, statusLabel, releaseLine, builtinSkyCrew } from './ui.js';

const $id = (id) => document.getElementById(id);

function featuredCard(g) {
  const cover = coverOf(g);
  const mark = !cover || /batlas-(logo|mark)/.test(cover);
  const video = safeUrl(g.trailerVideo);
  // Muted, inline, looping preview: iOS Safari only autoplays video that is muted + playsinline.
  const media = video
    ? h('video', { src: video, poster: cover || null, muted: true, autoplay: true, loop: true, playsinline: true, 'webkit-playsinline': true, preload: 'metadata', 'aria-label': `${g.title} trailer preview` })
    : cover ? h('img', { src: cover, alt: `${g.title} cover art` }) : h('img', { class: 'mark', src: '/img/batlas-mark.png', alt: '' });
  if (media.tagName === 'VIDEO') media.muted = true; // property too, for Safari
  const play = safeUrl(g.playUrl);
  const canPlay = play && g.settings?.playEnabled !== false && (g.status === 'published' || g.status === 'upcoming');
  return h('article', { class: 'featured', 'aria-label': `Featured: ${g.title}` },
    h('a', { class: mark ? 'f-media is-mark' : 'f-media', href: `/games/${encodeURIComponent(g.slug)}`, 'aria-label': g.title },
      media,
      h('div', { class: 'f-overlay' },
        h('span', { class: `pill ${g.status}` }, statusLabel(g)),
        h('h3', {}, g.title))),
    h('div', { class: 'f-body' },
      h('div', { class: 'f-copy' },
        h('div', { class: 'meta' }, releaseLine(g), g.version ? h('span', {}, `v${g.version}`) : null),
        h('h3', {}, g.title),
        h('p', {}, g.tagline || '')),
      g.settings?.playEnabled === false && g.settings?.maintenanceMessage ? h('p', { class: 'notice' }, g.settings.maintenanceMessage) : null,
      h('div', { class: 'actions' },
        canPlay ? h('a', { class: 'btn primary go', href: play, id: 'featured-play' }, g.status === 'upcoming' ? 'Play early build' : 'Play') : null,
        h('a', { class: 'btn', href: `/games/${encodeURIComponent(g.slug)}`, id: 'featured-details' }, 'Details'))));
}

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
// The catalog is whatever the studio has published. A fresh database still has Sky Crew on disk.
const listed = games.length ? games : [builtinSkyCrew];
const pub = listed.filter((g) => g.status === 'published');
const up = listed.filter((g) => g.status === 'upcoming').sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));

const feat = listed.find((g) => g.settings?.featured) || pub[0] || up[0];
$id('featured').replaceChildren(feat ? featuredCard(feat) : h('p', { class: 'empty-note' }, 'The hangar is quiet. New games will show up here.'));
const count = $id('collection-count');
if (count) count.textContent = listed.length === 1 ? '01 game' : `${String(listed.length).padStart(2, '0')} games`;

const heroPlay = $id('hero-play');
if (heroPlay) {
  if (feat && safeUrl(feat.playUrl) && feat.settings?.playEnabled !== false) {
    heroPlay.href = safeUrl(feat.playUrl);
    heroPlay.textContent = `Play ${feat.title}`;
  } else if (!listed.some((g) => g.slug === 'sky-crew')) heroPlay.remove();
}

const upList = up.filter((g) => g !== feat);
if (!upList.length) {
  $id('upcoming-rule')?.remove();
  $id('upcoming')?.remove();
} else $id('upcoming').replaceChildren(...upList.map(gameCard));

const posts = newsR.status === 'fulfilled' ? newsR.value.posts : [];
$id('news-list').replaceChildren(...(posts.length ? posts.map(newsCard) : [h('p', { class: 'empty-note' }, 'No announcements yet.')]));

if (me.status === 'fulfilled' && me.value.user) {
  $id('cta-band')?.remove();
  const j = $id('hero-join');
  if (j) { j.href = '/profile'; j.textContent = 'Your profile'; }
}
