import { api, h, fmtDay, safeUrl, timeUntil, openPasses } from './common.js';
import { openLightbox } from './lightbox.js';
import { coverOf, builtinSkyCrew } from './ui.js';

const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
const root = document.getElementById('game');

const ytId = (url) => (url || '').match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/)?.[1] || null;
function youtube(id, title) {
  return h('iframe', { src: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`, title: `${title} trailer (YouTube)`, allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowfullscreen: true, loading: 'lazy', referrerpolicy: 'strict-origin-when-cross-origin' });
}
function video(src, poster, title) {
  // Click-to-play with controls; playsinline keeps iOS from forcing fullscreen. Served with Range support.
  return h('video', { src, poster: poster || null, controls: true, playsinline: true, 'webkit-playsinline': true, preload: 'metadata', 'aria-label': `${title} trailer`, class: 'trailer-video' });
}

/** Every way this game can be shown in the media box, best first. */
function mediaOptions(g) {
  const opts = [];
  const poster = safeUrl(g.trailerPoster) || safeUrl(g.coverImage);
  if (safeUrl(g.trailerVideo)) opts.push(['Trailer', () => video(safeUrl(g.trailerVideo), poster, g.title)]);
  const yt = ytId(g.youtubeUrl) || ytId(g.trailerUrl);
  if (yt) opts.push(['YouTube', () => youtube(yt, g.title)]);
  const legacy = g.trailerUrl;
  if (legacy && !yt) {
    const vm = legacy.match(/vimeo\.com\/(\d+)/);
    if (vm) opts.push(['Trailer', () => h('iframe', { src: `https://player.vimeo.com/video/${vm[1]}?playsinline=1`, title: 'Trailer', allow: 'fullscreen; picture-in-picture', allowfullscreen: true })]);
    else if (/\.(mp4|webm)(\?|$)/i.test(legacy) && safeUrl(legacy)) opts.push(['Trailer', () => video(safeUrl(legacy), poster, g.title)]);
  }
  const cover = coverOf(g);
  if (cover) opts.push(['Cover', () => h('img', { src: cover, alt: `${g.title} cover art` })]);
  if (!opts.length) opts.push(['', () => h('div', { class: 'media-placeholder' }, h('img', { src: '/img/batlas-mark.png', alt: '' }))]);
  return opts;
}

function mediaBox(g) {
  const box = h('div', { class: 'media', id: 'game-media' });
  const opts = mediaOptions(g);
  const sw = h('div', { class: 'media-switch', role: 'tablist', 'aria-label': 'Trailer and images' });
  const pick = (n) => {
    box.replaceChildren(opts[n][1]());
    sw.querySelectorAll('button').forEach((b, j) => { b.classList.toggle('active', j === n); b.setAttribute('aria-selected', String(j === n)); });
  };
  if (opts.length > 1) opts.forEach(([label], n) => sw.append(h('button', { type: 'button', role: 'tab', dataset: { media: label.toLowerCase() }, onclick: () => pick(n) }, label)));
  pick(0);
  return h('div', {}, box, opts.length > 1 ? sw : null);
}

function actions(g) {
  const row = h('div', { class: 'game-actions' });
  const play = safeUrl(g.playUrl);
  const live = g.status === 'published' || g.status === 'upcoming';
  if (play && live && g.settings.playEnabled !== false) {
    if (g.settings.earlyAccessOnly && g.youCanPlay === false) {
      row.append(h('button', { class: 'btn primary lg play-wide', type: 'button', id: 'play-btn', onclick: () => openPasses() }, 'Preview pass needed'));
    } else row.append(h('a', { class: 'btn primary lg play-wide', href: play, id: 'play-btn' }, g.status === 'upcoming' ? 'Play the test build' : `Play ${g.title}`));
  }
  // The server only fills `download` when the file exists and downloads are enabled.
  const dl = safeUrl(g.download);
  if (dl) row.append(h('a', { class: 'btn lg', href: dl, id: 'download-btn', rel: 'noopener', download: dl.startsWith('/') ? '' : null }, g.latestVersion ? `Download v${g.latestVersion.version}` : 'Download'));
  if (g.screenshots.length) row.append(h('button', { class: 'btn lg ghost', type: 'button', id: 'gallery-btn', onclick: (e) => openLightbox(shots(g), 0, e.currentTarget) }, `Screenshots (${shots(g).length})`));
  return row;
}

const shots = (g) => g.screenshots.map(safeUrl).filter(Boolean).map((src, i) => ({ src, alt: `${g.title} screenshot ${i + 1}` }));

function titleLines(title) {
  return title.trim().split(/\s+/).map((w) => h('span', {}, w));
}
const SKY_FEATURES = [
  ['The cabin', 'Bags, passengers and a galley that does not stay tidy. Anyone can answer a call. The matching job scores more.'],
  ['The flight', 'A short hop from Harbor Field. One person flies. The rest of the crew can still reach the yoke.'],
  ['Your account', 'The same handle and PIN you use on the rest of Batlas. No email. Up to eight people in a room.'],
];
function featuresFor(g) {
  if (g.slug === 'sky-crew') return SKY_FEATURES;
  const bits = String(g.description || g.tagline || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const cols = [
    ['The game', bits[0] || g.tagline || 'More about this game is on the way.'],
    ['Where it runs', (g.platforms || []).join(', ') || 'In the browser.'],
    ['Your account', 'Handle and PIN. The same Batlas sign-in as every other game.'],
  ];
  return cols;
}
function metaFor(g) {
  if (g.slug === 'sky-crew') return [['Crew', '1–8'], ['Plays on', 'iPad, iPhone, Mac'], ['Account', 'Handle + PIN']];
  return [
    ['Status', g.status === 'upcoming' ? 'Coming soon' : 'Out now'],
    ['Version', g.version ? `v${g.version}` : '—'],
    ['Plays on', (g.platforms || []).slice(0, 3).join(', ') || 'Browser'],
  ];
}

async function renderGame(g) {
  document.title = `${g.title} · Batlas`;
  const until = g.releaseDate ? timeUntil(g.releaseDate + 'T00:00:00') : '';
  const top = h('section', { class: 'game-sheet rise' },
    h('a', { class: 'back-link', href: '/games' }, '← All games'),
    h('div', { class: 'game-split' },
      h('div', { class: 'game-art' }, mediaBox(g)),
      h('div', { class: 'game-intro' },
        h('p', { class: 'eyebrow' }, g.settings?.earlyAccessOnly ? 'Preview build' : g.status === 'upcoming' ? 'In development' : 'In the browser'),
        h('h1', {}, ...titleLines(g.title)),
        h('p', { class: 'tagline' }, g.tagline || ''),
        h('p', { class: 'desc' }, g.description || ''),
        h('div', { class: 'meta-labels' }, ...metaFor(g).map(([k, v]) => h('div', {}, h('span', {}, k), h('b', {}, v)))),
        g.status === 'upcoming' ? h('p', { class: 'release', id: 'release-date' }, g.releaseDate ? `Releases ${fmtDay(g.releaseDate)}${until ? ` · ${until}` : ''}` : 'Release date TBA') : null,
        g.settings.playEnabled === false ? h('p', { class: 'notice', id: 'play-notice' }, g.settings.maintenanceMessage || 'Playing is paused for a moment while we update the game.') : null,
        actions(g))));

  const gallery = shots(g).length ? h('section', { id: 'screenshots' }, h('h2', {}, 'Screenshots'),
    h('div', { class: 'gallery' }, shots(g).map((s, i) => h('button', { type: 'button', 'aria-label': `Open screenshot ${i + 1}`, onclick: (e) => openLightbox(shots(g), i, e.currentTarget) }, h('img', { src: s.src, alt: s.alt, loading: 'lazy' }))))) : null;

  const main = h('div', {},
    h('section', { class: 'feature-cols' }, ...featuresFor(g).map(([t, d]) => h('article', {}, h('h3', {}, t), h('p', {}, d)))),
    gallery,
    g.versions && g.versions.length > 1 ? h('section', {}, h('h2', {}, 'Version history'), h('div', { class: 'version-list' }, g.versions.slice(1).map((v) =>
      h('div', { class: 'version' }, h('strong', {}, `v${v.version}`), h('span', { class: 'small muted' }, ' · ', fmtDay(v.releasedAt)), v.changelog ? h('div', { class: 'changelog small' }, v.changelog) : null)))) : null);

  const side = h('aside', { class: 'side' },
    g.latestVersion ? h('section', { class: 'card section-head-block', id: 'whats-new' },
      h('h2', {}, `What's new in v${g.latestVersion.version}`),
      h('p', { class: 'small muted' }, 'Released ', fmtDay(g.latestVersion.releasedAt)),
      h('div', { class: 'changelog' }, g.latestVersion.changelog || 'No changelog for this version.')) : null,
    g.news?.length ? h('section', { class: 'card section-head-block' }, h('h2', {}, 'News'), h('div', { class: 'version-list' }, g.news.map((n) =>
      h('a', { class: 'version', href: `/news/${encodeURIComponent(n.slug)}` }, h('strong', {}, n.title), h('div', { class: 'small muted' }, fmtDay(n.publishedAt)))))) : null);

  root.replaceChildren(top, h('div', { class: 'game-cols' }, main, side));
  if (g.slug === 'sky-crew' && g.settings.showLeaderboard !== false) {
    root.append(h('p', { class: 'leaderboard' }, h('a', { href: '/leaderboard' }, 'This week’s flights →')));
  }
}

try {
  const { game: g } = await api('GET', `/api/games/${encodeURIComponent(slug)}`);
  await renderGame(g);
} catch (e) {
  if (slug === 'sky-crew' && e.status === 404) await renderGame(builtinSkyCrew);
  else root.replaceChildren(h('div', { class: 'card center-box' }, h('p', { class: 'eyebrow' }, 'Batlas'), h('h1', {}, 'Game not found'), h('a', { class: 'btn', href: '/games' }, 'All games')));
}

