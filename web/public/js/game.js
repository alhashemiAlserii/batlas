import { api, h, fmtDay, rankBadge } from './common.js';
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
  const media = trailer(g.trailerUrl) || (g.coverImage ? h('img', { src: g.coverImage, alt: g.title }) : h('div', { class: 'media-placeholder' }, h('img', { src: '/img/batlas-mark.png', alt: '' })));
  const actions = h('div', { class: 'inline' });
  if (g.status === 'published' && safeUrl(g.playUrl)) actions.append(h('a', { class: 'btn primary', href: safeUrl(g.playUrl) }, '▶ Play in browser'));
  if (g.status === 'upcoming' && safeUrl(g.playUrl)) actions.append(h('a', { class: 'btn primary', href: safeUrl(g.playUrl) }, '▶ Play early build'));
  const dl = safeUrl(g.latestVersion?.downloadUrl) || safeUrl(g.downloadUrl);
  if (g.status === 'published' && dl) actions.append(h('a', { class: 'btn', href: dl, rel: 'noopener' }, g.latestVersion ? `⬇ Download v${g.latestVersion.version}` : '⬇ Download'));
  if (g.status === 'upcoming') actions.append(h('span', { class: 'pill upcoming' }, 'Coming soon'));
  root.replaceChildren(...[
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
    h('section', { class: 'about' }, h('h2', {}, 'About'), h('p', { class: 'desc' }, g.description || 'More details soon.')),
    g.latestVersion ? h('section', { class: 'card section-head-block' },
      h('h2', {}, `What's new in v${g.latestVersion.version}`),
      h('p', { class: 'small muted' }, 'Released ', fmtDay(g.latestVersion.releasedAt)),
      h('div', { class: 'changelog' }, g.latestVersion.changelog || 'No changelog for this version.')) : null,
    g.versions && g.versions.length > 1 ? h('section', {}, h('h2', {}, 'Version history'), h('div', { class: 'version-list' }, g.versions.slice(1).map((v) =>
      h('div', { class: 'version' }, h('strong', {}, `v${v.version}`), h('span', { class: 'small muted' }, ' · ', fmtDay(v.releasedAt)), v.changelog ? h('div', { class: 'changelog small' }, v.changelog) : null)))) : null,
    g.screenshots.length ? h('section', {}, h('h2', {}, 'Screenshots'), h('div', { class: 'shots' }, g.screenshots.filter(safeUrl).map((s) => h('a', { href: s, target: '_blank', rel: 'noopener' }, h('img', { src: s, alt: 'Screenshot', loading: 'lazy' }))))) : null,
  ].filter(Boolean));
  if (g.slug === 'sky-crew') root.append(await leaderboard());
} catch (e) {
  root.replaceChildren(h('div', { class: 'card center-box' }, h('h1', {}, 'Game not found'), h('a', { class: 'btn', href: '/games' }, 'Back to games')));
}

async function leaderboard() {
  const sec = h('section', { class: 'leaderboard' }, h('div', { class: 'section-head' }, h('h2', {}, 'Leaderboard'), h('span', { class: 'small muted' }, 'Best single-flight payout per pilot (airline credits)')));
  try {
    const { leaderboard: rows } = await api('GET', '/api/games/sky-crew/leaderboard');
    if (!rows.length) { sec.append(h('p', { class: 'muted' }, 'No flights recorded yet. Sign in, fly a route and get paid to be first!')); return sec; }
    sec.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', {}, 'Best payout'), h('th', {}, 'Flights'))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, String(r.rank)),
        h('td', {}, h('a', { href: `/u/${encodeURIComponent(r.username)}`, class: `name-${r.role.toLowerCase()}` }, r.displayName), ' ', rankBadge(r.role)),
        h('td', {}, h('strong', {}, `₵${Number(r.bestScore).toLocaleString('en-US')}`)),
        h('td', {}, String(r.flights))))))));
    sec.append(h('p', { class: 'small muted' }, 'Scores are reported by the game in your browser.'));
  } catch { sec.append(h('p', { class: 'muted' }, 'Leaderboard unavailable right now.')); }
  return sec;
}
