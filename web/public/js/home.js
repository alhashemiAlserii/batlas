import { api, h, getMe, fmtDay, safeUrl } from './common.js';
import { gameCard, coverOf, statusLabel, releaseLine } from './ui.js';

const $id = (id) => document.getElementById(id);

function featuredCard(g) {
  const cover = coverOf(g);
  const video = safeUrl(g.trailerVideo);
  // Muted, inline, looping preview: iOS Safari only autoplays video that is muted + playsinline.
  const media = video
    ? h('video', { src: video, poster: cover || null, muted: true, autoplay: true, loop: true, playsinline: true, 'webkit-playsinline': true, preload: 'metadata', 'aria-label': `${g.title} trailer preview` })
    : cover ? h('img', { src: cover, alt: `${g.title} cover art` }) : h('div', { class: 'ph' }, '✈');
  if (media.tagName === 'VIDEO') media.muted = true; // property too, for Safari
  const play = safeUrl(g.playUrl);
  const canPlay = play && g.settings?.playEnabled !== false && (g.status === 'published' || g.status === 'upcoming');
  return h('article', { class: 'featured', 'aria-label': `Featured: ${g.title}` },
    h('a', { class: 'f-media', href: `/games/${encodeURIComponent(g.slug)}`, 'aria-label': g.title }, media),
    h('div', { class: 'f-body' },
      h('div', { class: 'inline' }, h('span', { class: `pill ${g.status}` }, statusLabel(g)), releaseLine(g), g.version ? h('span', { class: 'small muted' }, `v${g.version}`) : null),
      h('h3', {}, g.title),
      h('p', { class: 'muted' }, g.tagline || ''),
      g.settings?.playEnabled === false && g.settings?.maintenanceMessage ? h('p', { class: 'notice' }, g.settings.maintenanceMessage) : null,
      h('div', { class: 'actions' },
        canPlay ? h('a', { class: 'btn primary', href: play, id: 'featured-play' }, g.status === 'upcoming' ? '▶ Play early build' : '▶ Play in browser') : null,
        h('a', { class: 'btn', href: `/games/${encodeURIComponent(g.slug)}`, id: 'featured-details' }, 'Game details'))));
}

function newsCard(p) {
  const cover = safeUrl(p.coverImage);
  return h('a', { class: 'card news-card', href: `/news/${encodeURIComponent(p.slug)}` },
    h('div', { class: 'thumb' }, cover ? h('img', { src: cover, alt: '', loading: 'lazy' }) : h('img', { class: 'mark', src: '/img/batlas-mark.png', alt: '' })),
    h('div', { class: 'body' },
      h('div', { class: 'news-meta' }, p.pinned ? h('span', { class: 'pill pinned' }, '📌 Pinned') : null, h('span', {}, fmtDay(p.publishedAt))),
      h('h3', {}, p.title), p.summary ? h('p', { class: 'muted small' }, p.summary) : null));
}

const [gamesR, newsR, me] = await Promise.allSettled([api('GET', '/api/games'), api('GET', '/api/news?limit=3'), getMe()]);
const games = gamesR.status === 'fulfilled' ? gamesR.value.games : [];
const pub = games.filter((g) => g.status === 'published');
const up = games.filter((g) => g.status === 'upcoming').sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));

const feat = games.find((g) => g.settings?.featured) || pub[0] || up[0];
$id('featured').replaceChildren(feat ? featuredCard(feat) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No games released yet. Stay tuned!')));
const heroPlay = $id('hero-play');
if (feat && safeUrl(feat.playUrl) && feat.settings?.playEnabled !== false) { heroPlay.href = safeUrl(feat.playUrl); heroPlay.textContent = `▶ Play ${feat.title}`; }
else if (!games.some((g) => g.slug === 'sky-crew')) heroPlay.remove();

const upList = up.filter((g) => g !== feat);
$id('upcoming').replaceChildren(...(upList.length ? upList.map(gameCard) : [h('div', { class: 'card' }, h('p', { class: 'muted m0' }, 'Nothing else announced yet. Follow the news for reveals!'))]));

const posts = newsR.status === 'fulfilled' ? newsR.value.posts : [];
$id('news-list').replaceChildren(...(posts.length ? posts.map(newsCard) : [h('div', { class: 'card' }, h('p', { class: 'muted m0' }, 'No announcements yet. Check back soon!'))]));

$id('hero-stats').replaceChildren(
  h('div', {}, h('b', {}, String(pub.length)), pub.length === 1 ? 'game out now' : 'games out now'),
  h('div', {}, h('b', {}, String(up.length)), 'in development'),
  h('div', {}, h('b', {}, '1'), 'account for all'));

if (me.status === 'fulfilled' && me.value.user) {
  $id('cta-band')?.remove();
  const j = $id('hero-join'); j.href = '/profile'; j.textContent = 'My profile';
}
