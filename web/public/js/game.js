import { api, h } from './common.js';
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
const root = document.getElementById('game');

function trailer(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (yt) return h('iframe', { src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, title: 'Trailer', allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy' });
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return h('iframe', { src: `https://player.vimeo.com/video/${vm[1]}`, title: 'Trailer', allow: 'fullscreen; picture-in-picture', allowfullscreen: true });
  if (/\.(mp4|webm)(\?|$)/i.test(url)) return h('video', { src: url, controls: true, playsinline: true, preload: 'metadata' });
  return null;
}
const safeUrl = (u) => (/^(https?:\/\/|\/)/i.test(u || '') ? u : null);

try {
  const { game: g } = await api('GET', `/api/games/${encodeURIComponent(slug)}`);
  document.title = `${g.title} · Batlas`;
  const media = trailer(g.trailerUrl) || (g.coverImage ? h('img', { src: g.coverImage, alt: g.title }) : h('div', { class: 'cover' }, '✈'));
  const actions = h('div', { class: 'inline' });
  if (g.status === 'published' && safeUrl(g.playUrl)) actions.append(h('a', { class: 'btn primary', href: safeUrl(g.playUrl) }, '▶ Play in browser'));
  if (g.status === 'published' && safeUrl(g.downloadUrl)) actions.append(h('a', { class: 'btn', href: safeUrl(g.downloadUrl), rel: 'noopener' }, '⬇ Download'));
  if (g.status === 'upcoming') actions.append(h('span', { class: 'pill upcoming' }, 'Coming soon'));
  root.replaceChildren(
    h('div', { class: 'game-hero' },
      h('div', { class: 'media' }, media),
      h('div', {},
        h('span', { class: `pill ${g.status}` }, g.status === 'upcoming' ? 'Upcoming' : 'Out now'),
        h('h1', {}, g.title),
        h('p', { class: 'muted' }, g.tagline),
        actions,
        h('div', { class: 'kv small', },
          g.version ? [h('span', { class: 'muted' }, 'Version'), h('span', {}, g.version)] : null,
          g.platforms.length ? [h('span', { class: 'muted' }, 'Platforms'), h('span', {}, g.platforms.join(', '))] : null))),
    h('section', {}, h('h2', {}, 'About'), h('p', { class: 'desc' }, g.description || 'More details soon.')),
    g.screenshots.length ? h('section', {}, h('h2', {}, 'Screenshots'), h('div', { class: 'shots' }, g.screenshots.filter(safeUrl).map((s) => h('a', { href: s, target: '_blank', rel: 'noopener' }, h('img', { src: s, alt: 'Screenshot', loading: 'lazy' }))))) : null,
  );
} catch (e) {
  root.replaceChildren(h('div', { class: 'card center-box' }, h('h1', {}, 'Game not found'), h('a', { class: 'btn', href: '/games' }, 'Back to games')));
}
