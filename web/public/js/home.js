import { api, h, safeUrl } from './common.js';
import { coverOf, withBuiltins, statusLabel } from './ui.js';

const $id = (id) => document.getElementById(id);
const GENRE = { 'sky-crew': 'Co-op flight', highcrag: 'Climb' };

const SOON = [
  { title: 'Night Beacon', genre: 'Lookout', blurb: 'A short watch on a dark coast. The light is drawn. The game is not boarded yet.', art: '/img/lineup/beacon.svg' },
  { title: 'Dock Shift', genre: 'Night shift', blurb: 'A pier, a few crates, and a crew that has not clocked in. Still on the drawing table.', art: '/img/lineup/dock.svg' },
];

function lines(title) {
  return title.trim().split(/\s+/).map((w) => h('span', {}, w));
}

function card(opts) {
  const artInner = [
    h('img', { src: opts.art, alt: '', loading: 'lazy' }),
    h('span', { class: 'idx' }, opts.index),
    h('span', { class: 'genre' }, opts.genre),
    h('h3', {}, ...lines(opts.title)),
    h('span', { class: 'circ', 'aria-hidden': 'true' }, '→'),
  ];
  const art = opts.href
    ? h('a', { class: 'art', href: opts.href, 'aria-label': opts.title }, ...artInner)
    : h('div', { class: 'art' }, ...artInner);
  const cap = h('div', { class: 'cap' }, h('p', {}, opts.blurb || ''), ...(opts.actions || []));
  return h('article', { class: `line-card${opts.feature ? ' is-feature' : ''}${opts.soon ? ' is-soon' : ''} rise` }, art, cap);
}

let listed = [];
try {
  const { games } = await api('GET', '/api/games');
  listed = withBuiltins(games);
} catch { listed = withBuiltins([]); }

const feat = listed.find((g) => g.slug === 'sky-crew') || listed.find((g) => g.settings?.featured) || listed[0];
const rest = listed.filter((g) => g !== feat);
const count = $id('lineup-count');
if (count) count.textContent = `${listed.length} ${listed.length === 1 ? 'game' : 'games'}`;

const nodes = [];
if (feat) {
  const play = safeUrl(feat.playUrl);
  const can = feat.settings?.playEnabled !== false && play;
  nodes.push(card({
    feature: true,
    title: feat.title,
    genre: GENRE[feat.slug] || statusLabel(feat),
    index: '01',
    art: coverOf(feat) || '/img/batlas-mark.png',
    href: `/games/${encodeURIComponent(feat.slug)}`,
    blurb: feat.tagline || '',
    actions: [
      can ? h('a', { class: 'btn primary', href: play }, 'Play') : h('a', { class: 'btn', href: `/games/${encodeURIComponent(feat.slug)}` }, 'Details'),
      feat.settings?.earlyAccessOnly ? h('span', { class: 'pill' }, 'Preview') : null,
    ],
  }));
}
rest.forEach((g, i) => {
  nodes.push(card({
    title: g.title,
    genre: GENRE[g.slug] || statusLabel(g),
    index: String(i + 2).padStart(2, '0'),
    art: coverOf(g) || '/img/batlas-mark.png',
    href: `/games/${encodeURIComponent(g.slug)}`,
    blurb: g.tagline || '',
    soon: g.status === 'upcoming',
  }));
});
SOON.forEach((g, i) => {
  nodes.push(card({
    soon: true,
    title: g.title,
    genre: 'Coming soon',
    index: String(rest.length + i + 2).padStart(2, '0'),
    art: g.art,
    blurb: g.blurb,
  }));
});
$id('lineup-grid').replaceChildren(...(nodes.length ? nodes : [h('p', { class: 'empty-note' }, 'The hangar is quiet. New games will show up here.')]));
