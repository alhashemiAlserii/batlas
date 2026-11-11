// Developer dashboard. Served only to DEVELOPER sessions (server-gated route); every API it
// calls is also Developer-only on the server.
import { api, h, getMe, rankBadge, showError, showOk, fmtDate, fmtDay, csrfToken, userChip } from '/js/common.js';
import { usersPanel, logPanel, gameControls } from '/js/staff.js';

const app = document.getElementById('app');
const me = await getMe();
const p = me.permissions;
const view = h('div');
const tabsDef = [['stats', 'Stats'], ['games', 'Games'], ['news', 'News'], ['inbox', 'Inbox'], ['users', 'Players & ranks'], ['online', 'Online'], ['events', 'Events'], ['media', 'Media'], ['site', 'Maintenance'], ['audit', 'Audit log'], ['rooms', 'Live rooms'], ['tools', 'Developer tools']];
const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...tabsDef.map(([k, l]) => h('button', { dataset: { k }, role: 'tab', onclick: () => show(k) }, l)));
app.replaceChildren(
  h('div', { class: 'card panel-dev' }, h('div', { class: 'panel-head' }, h('h1', {}, 'Developer dashboard'), rankBadge(me.role)),
    h('p', { class: 'muted' }, 'Owner controls for Batlas. This page is unlisted and only served to Developer accounts.')),
  tabs, view);

function show(k) {
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
  history.replaceState(null, '', `#${k}`);
  if (k === 'users') view.replaceChildren(usersPanel(me.user, p, { roles: true }));
  if (k === 'audit') view.replaceChildren(logPanel('Audit log', '/api/admin/audit', { categories: ['moderation', 'roles', 'game', 'games', 'media', 'news', 'site', 'auth', 'admin'] }));
  if (k === 'games') view.replaceChildren(gamesPanel());
  if (k === 'tools') view.replaceChildren(toolsPanel());
  if (k === 'stats') view.replaceChildren(statsPanel());
  if (k === 'news') view.replaceChildren(newsPanel());
  if (k === 'inbox') view.replaceChildren(inboxPanel());
  if (k === 'rooms') view.replaceChildren(roomsPanel());
  if (k === 'online') view.replaceChildren(onlinePanel());
  if (k === 'events') view.replaceChildren(eventsPanel());
  if (k === 'media') view.replaceChildren(mediaPanel());
  if (k === 'site') view.replaceChildren(sitePanel());
}

function toolsPanel() {
  const msg = h('div', { 'aria-live': 'polite' });
  const run = async (url, body) => { try { const r = await api('POST', url, body); showOk(msg, `Accepted and logged. ${r.note}`); } catch (e) { showError(msg, e); } };
  const tp = h('input', { placeholder: 'player or location, e.g. cockpit' });
  const npc = h('select', {}, ...['calm_all', 'panic', 'sit_down', 'dance', 'board', 'evacuate'].map((v) => h('option', { value: v }, v)));
  const cmd = h('input', { placeholder: 'e.g. godmode, freeze_time, night' });
  return h('div', {},
    gameControls(p),
    h('div', { class: 'section-head' }, h('h2', {}, 'Developer-only commands')), msg,
    h('div', { class: 'controls' },
      h('div', { class: 'card panel-dev' }, h('h3', {}, '🌀 Teleport'), h('div', { class: 'inline' }, tp, h('button', { class: 'btn', onclick: () => run('/api/game/teleport', { to: tp.value }) }, 'Teleport'))),
      h('div', { class: 'card panel-dev' }, h('h3', {}, '🧍 Control NPCs'), h('div', { class: 'inline' }, npc, h('button', { class: 'btn', onclick: () => run('/api/game/npc', { action: npc.value }) }, 'Send'))),
      h('div', { class: 'card panel-dev' }, h('h3', {}, '⌨ Hidden dev command'), h('div', { class: 'inline' }, cmd, h('button', { class: 'btn', onclick: () => run('/api/game/dev-command', { cmd: cmd.value }) }, 'Run')))));
}

/** Upload a file to the database-backed media library with a progress bar (XHR gives upload progress). */
function uploadMedia(file, { gameId, onProgress } = {}) {
  return csrfToken().then((tok) => new Promise((resolve, reject) => {
    const fd = new FormData();
    if (gameId) fd.append('gameId', String(gameId));
    fd.append('file', file);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/dev/media');
    x.withCredentials = true;
    x.setRequestHeader('x-csrf-token', tok);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      let d = null; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) resolve(d.media); else reject(new Error(d?.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error('Upload failed (network)'));
    x.send(fd);
  }));
}
const MB = (n) => `${(n / 1024 / 1024).toFixed(n > 1024 * 1024 ? 1 : 2)} MB`;

/** A file picker + upload button + progress bar. onDone(media) gets the stored media row. */
function uploader({ accept, label, gameId, onDone, id }) {
  const input = h('input', { type: 'file', accept, id, 'aria-label': label });
  const bar = h('i');
  const note = h('span', { class: 'small muted' });
  const btn = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    const f = input.files[0];
    if (!f) { note.textContent = 'Choose a file first.'; return; }
    btn.disabled = true; note.textContent = `Uploading ${MB(f.size)}…`;
    try {
      const m = await uploadMedia(f, { gameId, onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; } });
      note.textContent = `Uploaded ${m.url}`; input.value = '';
      onDone(m);
    } catch (e) { note.textContent = e.message; bar.style.width = '0'; }
    btn.disabled = false;
  } }, label);
  return h('div', { class: 'uploader' }, h('div', { class: 'inline' }, input, btn), h('div', { class: 'progress' }, bar), note);
}

const SETTINGS = [
  ['featured', 'Featured on the homepage'],
  ['playEnabled', 'Play in browser enabled'],
  ['downloadEnabled', 'Downloads enabled'],
  ['showLeaderboard', 'Show leaderboard (Sky Crew)'],
];

function gamesPanel() {
  const wrap = h('div');
  const list = h('div', { class: 'grid' });
  const editor = h('div');
  async function load() {
    try {
      const { games } = await api('GET', '/api/dev/games');
      list.replaceChildren(...(games.length ? games.map((g) => h('div', { class: 'card', dataset: { game: g.slug } },
        h('div', { class: 'panel-head' }, h('h3', {}, g.title), h('span', { class: `pill ${g.status}` }, g.status), g.settings?.featured ? h('span', { class: 'pill pinned' }, '★ Featured') : null),
        h('p', { class: 'small muted' }, `/${g.slug} · v${g.version || '—'}${g.releaseDate ? ` · release ${g.releaseDate}` : ''} · updated ${fmtDate(g.updatedAt)}`),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', onclick: () => edit(g) }, 'Edit'),
          ...['draft', 'upcoming', 'published'].filter((s) => s !== g.status).map((s) => h('button', { class: 'btn small', onclick: async () => { try { await api('POST', `/api/dev/games/${g.id}/publish`, { status: s }); load(); } catch (e) { showError(editor, e); } } }, s === 'published' ? 'Publish' : `Set ${s}`)),
          g.status !== 'draft' ? h('a', { class: 'btn small', href: `/games/${g.slug}`, target: '_blank' }, 'View') : null))) : [h('p', { class: 'muted' }, 'No games yet. Create your first one.')]));
    } catch (e) { showError(list, e); }
  }
  function field(name, labelTxt, value = '', opts = {}) {
    const id = `g-${name}`;
    const input = opts.textarea ? h('textarea', { id, name, ...opts.attrs }) : h('input', { id, name, ...opts.attrs });
    input.value = value ?? '';
    return h('div', { class: 'field' }, h('label', { for: id }, labelTxt), input, opts.hint ? h('p', { class: 'small muted' }, opts.hint) : null);
  }
  function edit(g = null, created = '') {
    const msg = h('div', { 'aria-live': 'polite' });
    if (created) showOk(msg, created);
    const status = h('select', { id: 'g-status', name: 'status' }, ...['draft', 'upcoming', 'published'].map((s) => h('option', { value: s, selected: (g?.status || 'draft') === s }, s)));
    let shotsArr = [...(g?.screenshots ?? [])];
    const shotList = h('div', { class: 'shot-list', id: 'shot-list' });
    const renderShots = () => shotList.replaceChildren(...(shotsArr.length ? shotsArr.map((u, i) => h('div', { class: 'shot' }, h('img', { src: u, alt: `Screenshot ${i + 1}` }),
      h('div', { class: 'ctrl' },
        h('button', { type: 'button', 'aria-label': 'Move left', disabled: i === 0, onclick: () => { [shotsArr[i - 1], shotsArr[i]] = [shotsArr[i], shotsArr[i - 1]]; renderShots(); } }, '◀'),
        h('button', { type: 'button', 'aria-label': 'Remove screenshot', onclick: () => { shotsArr.splice(i, 1); renderShots(); } }, '✕'),
        h('button', { type: 'button', 'aria-label': 'Move right', disabled: i === shotsArr.length - 1, onclick: () => { [shotsArr[i + 1], shotsArr[i]] = [shotsArr[i], shotsArr[i + 1]]; renderShots(); } }, '▶')))) : [h('span', { class: 'small muted' }, 'No screenshots yet.')]));
    renderShots();
    const s = { featured: false, playEnabled: true, downloadEnabled: true, showLeaderboard: true, maintenanceMessage: '', ...(g?.settings ?? {}) };
    const checks = SETTINGS.map(([k, l]) => { const c = h('input', { type: 'checkbox', id: `gs-${k}`, checked: !!s[k] }); return [k, c, h('label', { for: `gs-${k}` }, c, l)]; });
    const pausedMsg = h('input', { id: 'gs-maintenanceMessage', maxlength: 200, placeholder: 'e.g. Updating to v0.5, back in 10 minutes' }); pausedMsg.value = s.maintenanceMessage || '';
    const gid = g?.id;
    const form = h('form', { class: 'card panel-dev', novalidate: true, id: 'game-form' },
      h('h2', {}, g ? `Edit: ${g.title}` : 'New game'),
      h('div', { class: 'form-grid' },
        field('title', 'Title', g?.title, { attrs: { required: true, maxlength: 120 } }),
        field('slug', 'URL slug', g?.slug, { attrs: { required: true, pattern: '[a-z0-9-]+' }, hint: 'lowercase-with-dashes, used in /games/<slug>' })),
      field('tagline', 'Tagline', g?.tagline, { attrs: { maxlength: 200 } }),
      field('description', 'Description', g?.description, { textarea: true, attrs: { class: 'tall' } }),
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: 'g-status' }, 'Status'), status),
        field('releaseDate', 'Release date (upcoming games)', g?.releaseDate, { attrs: { type: 'date' } }),
        field('version', 'Version', g?.version, { hint: 'e.g. 0.1.0 (set automatically when you publish an update)' }),
        field('platforms', 'Platforms', g?.platforms?.join(', '), { hint: 'comma separated, e.g. Web, Windows' })),
      h('h3', {}, 'Images'),
      field('coverImage', 'Cover image', g?.coverImage, { hint: 'Upload below or paste a URL' }),
      uploader({ accept: 'image/png,image/jpeg,image/webp,image/gif', label: 'Upload cover', gameId: gid, id: 'up-cover', onDone: (m) => { form.coverImage.value = m.url; } }),
      h('div', { class: 'field shots-field' }, h('label', {}, 'Screenshots (gallery order)'), shotList,
        uploader({ accept: 'image/png,image/jpeg,image/webp,image/gif', label: 'Add screenshot', gameId: gid, id: 'up-shot', onDone: (m) => { shotsArr.push(m.url); renderShots(); } }),
        h('p', { class: 'small muted' }, 'PNG/JPEG/WebP/GIF, max 5 MB each. Stored in the database, so they survive redeploys.')),
      h('h3', {}, 'Trailer'),
      field('trailerVideo', 'Uploaded trailer (MP4)', g?.trailerVideo, { hint: 'H.264 MP4 plays everywhere incl. iPhone/iPad. Max 40 MB.' }),
      uploader({ accept: 'video/mp4', label: 'Upload trailer', gameId: gid, id: 'up-trailer', onDone: (m) => { form.trailerVideo.value = m.url; } }),
      field('trailerPoster', 'Trailer poster image', g?.trailerPoster, { hint: 'Shown before the video plays' }),
      uploader({ accept: 'image/png,image/jpeg,image/webp', label: 'Upload poster', gameId: gid, id: 'up-poster', onDone: (m) => { form.trailerPoster.value = m.url; } }),
      field('youtubeUrl', 'YouTube trailer link (optional)', g?.youtubeUrl, { hint: 'e.g. https://youtu.be/… — embedded privacy-enhanced' }),
      field('trailerUrl', 'Other trailer URL (legacy: Vimeo or external .mp4)', g?.trailerUrl),
      h('h3', {}, 'Play & download'),
      h('div', { class: 'form-grid' },
        field('playUrl', 'Play-in-browser URL', g?.playUrl, { hint: 'e.g. /play/sky-crew' }),
        field('downloadUrl', 'Download URL', g?.downloadUrl, { hint: 'The Download button only appears if this file exists' })),
      h('h3', {}, 'Game settings'),
      h('div', { class: 'checks', id: 'game-settings' }, checks.map((c) => c[2])),
      h('div', { class: 'field' }, h('label', { for: 'gs-maintenanceMessage' }, 'Message when play is disabled'), pausedMsg),
      msg,
      h('div', { class: 'inline' }, h('button', { class: 'btn primary', id: 'save-game' }, g ? 'Save changes' : 'Create game'), h('button', { type: 'button', class: 'btn', onclick: () => editor.replaceChildren() }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      for (const k of Object.keys(d)) if (d[k] instanceof File) delete d[k];
      const settings = Object.fromEntries(checks.map(([k, c]) => [k, c.checked]));
      settings.maintenanceMessage = pausedMsg.value.trim();
      const body = { ...d, platforms: d.platforms.split(',').map((x) => x.trim()).filter(Boolean), screenshots: shotsArr, settings };
      try {
        if (g) await api('PATCH', `/api/dev/games/${g.id}`, body);
        else { const r = await api('POST', '/api/dev/games', body); load(); edit(r.game, 'Game created. You can now publish updates for it below.'); return; }
        showOk(msg, 'Saved. Changes are live on the site immediately (no rebuild needed).');
        load();
      } catch (err) { showError(msg, err); }
    });
    editor.replaceChildren(...[h('div', { class: 'section-head' }), form, g ? versionsEditor(g) : null].filter(Boolean));
    form.scrollIntoView({ behavior: 'smooth' });
  }
  load();
  wrap.append(h('div', { class: 'panel-head' }, h('h2', {}, 'Games'), h('button', { class: 'btn primary small', id: 'new-game', onclick: () => edit() }, '+ New game')), list, editor);
  return wrap;
}

show(tabsDef.some(([k]) => `#${k}` === location.hash) ? location.hash.slice(1) : 'stats');

function versionsEditor(g) {
  const msg = h('div', { 'aria-live': 'polite' });
  const list = h('div', { class: 'version-list' });
  async function load() {
    const { versions } = await api('GET', `/api/dev/games/${g.id}/versions`);
    list.replaceChildren(...(versions.length ? versions.map((v) => h('div', { class: 'version' },
      h('div', { class: 'panel-head' }, h('strong', {}, `v${v.version}`), h('span', { class: 'small muted' }, fmtDay(v.releasedAt)),
        h('button', { class: 'btn small danger', onclick: async () => { if (confirm(`Delete v${v.version}?`)) { await api('DELETE', `/api/dev/games/${g.id}/versions/${v.id}`); load(); } } }, 'Delete')),
      v.changelog ? h('div', { class: 'changelog small' }, v.changelog) : null,
      v.downloadUrl ? h('div', { class: 'small muted' }, 'Download: ', v.downloadUrl) : null)) : [h('p', { class: 'muted small' }, 'No versions yet.')]));
  }
  const today = new Date().toISOString().slice(0, 10);
  const f = h('form', { novalidate: true },
    h('div', { class: 'inline' },
      h('input', { name: 'version', id: 'v-version', placeholder: 'Version, e.g. 0.2.0', 'aria-label': 'Version', required: true }),
      h('input', { name: 'releasedAt', type: 'date', value: today, 'aria-label': 'Release date', required: true })),
    h('div', { class: 'field shots-field' }, h('label', { for: 'v-cl' }, 'Changelog'), h('textarea', { id: 'v-cl', name: 'changelog', placeholder: '- New: luggage physics\n- Fixed: wobbly service cart' })),
    h('div', { class: 'field' }, h('label', { for: 'v-dl' }, 'Download URL (optional)'), h('input', { id: 'v-dl', name: 'downloadUrl' })),
    h('label', { class: 'switch', for: 'v-news' }, h('input', { type: 'checkbox', id: 'v-news', name: 'postNews' }), 'Also publish as a news post (shown on the homepage and game page)'),
    msg, h('button', { class: 'btn primary', id: 'add-version' }, 'Publish update'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const postNews = !!d.postNews; delete d.postNews;
    try {
      const { version: v } = await api('POST', `/api/dev/games/${g.id}/versions`, d);
      let extra = '';
      if (postNews) {
        const slug = `${g.slug}-${v.version}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
        await api('POST', '/api/dev/news', { slug, title: `${g.title} v${v.version} is out`, summary: (v.changelog.split('\n')[0] || `Update ${v.version}`).replace(/^[-*]\s*/, '').slice(0, 300), body: v.changelog, status: 'published', gameId: g.id, coverImage: g.coverImage || '' });
        extra = ' A news post was published too.';
      }
      f.reset(); f.releasedAt.value = today; showOk(msg, `Version ${v.version} published. The game page now shows it as the latest.${extra}`); load();
    }
    catch (err) { showError(msg, err); }
  });
  load();
  return h('div', {}, h('div', { class: 'section-head' }), h('section', { class: 'card panel-dev' }, h('h2', {}, `Versions: ${g.title}`), f, h('div', { class: 'section-head' }), list));
}

function statsPanel() {
  const root = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  api('GET', '/api/dev/stats').then((s) => {
    const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'n' }, String(n)), h('div', { class: 'l' }, l));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
    const W = 600, H = 160, pad = 18, bw = (W - pad * 2) / s.dailySignups.length;
    const max = Math.max(1, ...s.dailySignups.map((d) => d.count));
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H + 20}`, class: 'chart', role: 'img', 'aria-label': 'Sign-ups per day, last 30 days' });
    const defs = svg('defs'); const grad = svg('linearGradient', { id: 'barGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: '0%', 'stop-color': '#19d3e6' }), svg('stop', { offset: '100%', 'stop-color': '#1e6bff' })); defs.append(grad); chart.append(defs);
    s.dailySignups.forEach((d, i) => {
      const bh = (d.count / max) * (H - 20);
      const r = svg('rect', { x: pad + i * bw + 2, y: H - bh, width: Math.max(1, bw - 4), height: bh, rx: 3, class: 'bar' });
      const t = svg('title'); t.textContent = `${d.date}: ${d.count}`; r.append(t); chart.append(r);
    });
    const lbl = (x, txt, anchor) => { const t = svg('text', { x, y: H + 14, 'text-anchor': anchor }); t.textContent = txt; return t; };
    chart.append(lbl(pad, s.dailySignups[0].date, 'start'), lbl(W - pad, s.dailySignups.at(-1).date, 'end'), (() => { const t = svg('text', { x: pad, y: 12 }); t.textContent = `max ${max}/day`; return t; })());
    root.replaceChildren(
      h('div', { class: 'stat-grid' },
        stat(s.totalUsers, 'Total accounts'), stat(s.signups7d, 'New in last 7 days'), stat(s.signups30d, 'New in last 30 days'),
        stat(s.activeSessionUsers, 'Users with active sessions'), stat(s.logins7d, 'Logged in (7 days)'), stat(s.verifiedUsers, 'Verified emails'),
        stat(s.bannedUsers, 'Banned'), stat(s.moderationActions30d, 'Moderation actions (30d)'), stat(s.unreadMessages, 'Unread messages'),
        stat(s.games, 'Games'), stat(s.newsPublished, 'Published news')),
      h('div', { class: 'section-head' }),
      h('div', { class: 'settings-grid' },
        h('section', { class: 'card' }, h('h2', {}, 'Sign-ups, last 30 days'), chart),
        h('section', { class: 'card' }, h('h2', {}, 'Accounts by rank'), h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Rank'), h('th', {}, 'Accounts'))),
          h('tbody', {}, ...['DEVELOPER', 'ADMIN', 'TRUSTED', 'PLAYER'].map((r) => h('tr', {}, h('td', {}, rankBadge(r)), h('td', {}, String(s.byRole[r] ?? 0))))))))),
      h('p', { class: 'small muted' }, 'Updated ', fmtDate(s.generatedAt)));
  }).catch((e) => showError(root, e));
  return root;
}

function newsPanel() {
  const list = h('div', { class: 'news-list' });
  const editor = h('div');
  async function load() {
    const { posts } = await api('GET', '/api/dev/news');
    list.replaceChildren(...(posts.length ? posts.map((p) => h('div', { class: 'card' },
      h('div', { class: 'panel-head' }, h('h3', {}, p.title), h('span', { class: `pill ${p.status === 'published' ? 'published' : 'draft'}` }, p.status), p.pinned ? h('span', { class: 'pill pinned' }, '📌 Pinned') : null),
      h('p', { class: 'small muted' }, `/news/${p.slug} · updated ${fmtDate(p.updatedAt)}`),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', onclick: () => edit(p) }, 'Edit'),
        h('button', { class: 'btn small', onclick: async () => { await api('POST', `/api/dev/news/${p.id}/status`, { status: p.status === 'published' ? 'draft' : 'published' }); load(); } }, p.status === 'published' ? 'Unpublish' : 'Publish'),
        h('button', { class: 'btn small', onclick: async () => { await api('POST', `/api/dev/news/${p.id}/pin`, { pinned: !p.pinned }); load(); } }, p.pinned ? 'Unpin' : 'Pin'),
        p.status === 'published' ? h('a', { class: 'btn small', href: `/news/${p.slug}`, target: '_blank' }, 'View') : null))) : [h('p', { class: 'muted' }, 'No posts yet.')]));
  }
  function edit(p = null) {
    const msg = h('div', { 'aria-live': 'polite' });
    const inp = (name, label, val, attrs = {}) => { const i = h('input', { id: `n-${name}`, name, ...attrs }); i.value = val ?? ''; return h('div', { class: 'field' }, h('label', { for: `n-${name}` }, label), i); };
    const body = h('textarea', { id: 'n-body', name: 'body', class: 'tall' }); body.value = p?.body ?? '';
    const pinned = h('input', { type: 'checkbox', id: 'n-pinned', name: 'pinned', checked: !!p?.pinned });
    const status = h('select', { id: 'n-status', name: 'status' }, ...['draft', 'published'].map((s) => h('option', { value: s, selected: (p?.status ?? 'draft') === s }, s)));
    const gameSel = h('select', { id: 'n-game', 'aria-label': 'Related game' }, h('option', { value: '' }, 'No game'));
    api('GET', '/api/dev/games').then(({ games }) => gameSel.append(...games.map((g) => h('option', { value: g.id, selected: p?.gameId === g.id }, g.title)))).catch(() => {});
    const f = h('form', { class: 'card panel-dev', novalidate: true }, h('h2', {}, p ? `Edit: ${p.title}` : 'New announcement'),
      inp('title', 'Title', p?.title, { maxlength: 160, required: true }),
      inp('slug', 'URL slug', p?.slug, { pattern: '[a-z0-9-]+', required: true }),
      inp('summary', 'Summary (shown in lists)', p?.summary, { maxlength: 300 }),
      h('div', { class: 'field' }, h('label', { for: 'n-body' }, 'Body'), body),
      inp('coverImage', 'Cover image URL (optional; upload in the Media tab)', p?.coverImage),
      h('div', { class: 'field' }, h('label', { for: 'n-game' }, 'Related game (shows on its game page)'), gameSel),
      h('div', { class: 'inline' }, h('label', { for: 'n-status' }, 'Status'), status, h('label', { for: 'n-pinned', class: 'inline' }, pinned, ' Pin to top')),
      msg, h('div', { class: 'inline section-head' }, h('button', { class: 'btn primary' }, p ? 'Save' : 'Create'), h('button', { type: 'button', class: 'btn', onclick: () => editor.replaceChildren() }, 'Cancel')));
    const title = f.querySelector('#n-title'), slug = f.querySelector('#n-slug');
    if (!p) title.addEventListener('input', () => { slug.value = title.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const payload = { title: d.title, slug: d.slug, summary: d.summary, body: d.body, coverImage: d.coverImage, status: d.status, pinned: pinned.checked, gameId: gameSel.value ? Number(gameSel.value) : null };
      try { if (p) await api('PATCH', `/api/dev/news/${p.id}`, payload); else await api('POST', '/api/dev/news', payload); showOk(msg, 'Saved.'); load(); }
      catch (err) { showError(msg, err); }
    });
    editor.replaceChildren(h('div', { class: 'section-head' }), f);
    f.scrollIntoView({ behavior: 'smooth' });
  }
  load();
  return h('div', {}, h('div', { class: 'panel-head' }, h('h2', {}, 'News & announcements'), h('button', { class: 'btn primary small', onclick: () => edit() }, '+ New post')), list, editor);
}

function inboxPanel() {
  const list = h('div', { class: 'news-list' });
  const counts = h('span', { class: 'small muted' });
  const filter = h('select', { 'aria-label': 'Show' }, h('option', { value: '' }, 'Inbox (new + read)'), h('option', { value: 'new' }, 'Unread'), h('option', { value: 'read' }, 'Read'), h('option', { value: 'archived' }, 'Archived'));
  async function setStatus(id, status) { await api('PATCH', `/api/dev/inbox/${id}`, { status }); load(); }
  async function load() {
    const d = await api('GET', `/api/dev/inbox${filter.value ? `?status=${filter.value}` : ''}`);
    counts.textContent = `${d.counts.new ?? 0} unread · ${d.counts.read ?? 0} read · ${d.counts.archived ?? 0} archived`;
    list.replaceChildren(...(d.messages.length ? d.messages.map((m) => h('div', { class: `card msg-item ${m.status}` },
      h('div', { class: 'panel-head' }, h('h3', {}, m.subject), m.status === 'new' ? h('span', { class: 'pill pinned' }, 'New') : h('span', { class: 'pill' }, m.status)),
      h('p', { class: 'small muted' }, m.name, ' · ', m.email ? h('a', { href: `mailto:${encodeURIComponent(m.email).replace('%40', '@')}` }, m.email) : 'no email given', ' · ', fmtDate(m.createdAt)),
      h('div', { class: 'msg-body' }, m.message),
      h('div', { class: 'row-actions' },
        m.status !== 'read' ? h('button', { class: 'btn small', onclick: () => setStatus(m.id, 'read') }, 'Mark read') : h('button', { class: 'btn small', onclick: () => setStatus(m.id, 'new') }, 'Mark unread'),
        m.status !== 'archived' ? h('button', { class: 'btn small', onclick: () => setStatus(m.id, 'archived') }, 'Archive') : h('button', { class: 'btn small', onclick: () => setStatus(m.id, 'read') }, 'Restore')))) : [h('p', { class: 'muted' }, 'No messages here.')]));
  }
  filter.addEventListener('change', load);
  load();
  return h('div', {}, h('div', { class: 'panel-head' }, h('h2', {}, 'Inbox'), filter, counts), h('p', { class: 'small muted' }, 'Messages from the Contact page. Replies are not sent from here; use your email.'), list);
}
window.addEventListener('hashchange', () => {
  const k = location.hash.slice(1);
  if (tabsDef.some(([t]) => t === k)) show(k);
});

// Live Sky Crew rooms. The list comes from the game server, which checks the Developer rank it got
// from the website for this socket's game token (this page cannot grant itself anything).
function roomsPanel() {
  const msg = h('div', { 'aria-live': 'polite' });
  const hidden = h('input', { type: 'checkbox', id: 'joinHidden' });
  const tbody = h('tbody');
  let ws = null;
  async function load() {
    msg.replaceChildren('Loading…');
    try {
      if (!ws || ws.readyState > 1) {
        const { token } = await api('POST', '/api/game/token', { game: 'sky-crew' });
        ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/sky-crew`);
        await new Promise((res, rej) => {
          ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token }));
          ws.onerror = () => rej(new Error('Game server unreachable'));
          ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'welcome') res(); if (m.t === 'error') rej(new Error(m.message)); };
          setTimeout(() => rej(new Error('Game server did not answer')), 8000);
        });
      }
      const rooms = await new Promise((res, rej) => {
        ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'rooms') res(m.rooms); if (m.t === 'error') rej(new Error(m.message)); };
        ws.send(JSON.stringify({ t: 'rooms' }));
        setTimeout(() => rej(new Error('No answer')), 8000);
      });
      tbody.replaceChildren(...(rooms.length ? rooms.map((r) => h('tr', {},
        h('td', {}, h('strong', {}, r.code), r.locked ? ' 🔒' : ''),
        h('td', {}, r.host || '—'),
        h('td', {}, `${r.count}/${r.max}`, h('div', { class: 'small muted' }, r.players.map((p) => `${p.username}${p.hidden ? ' (hidden)' : ''}`).join(', '))),
        h('td', {}, r.route || '—'),
        h('td', {}, r.phase || 'lobby'),
        h('td', {}, h('button', { class: 'btn small primary', onclick: () => { location.href = `/play/sky-crew?devjoin=${encodeURIComponent(r.code)}${hidden.checked ? '&hidden=1' : ''}`; } }, 'Join')))) : [h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'No live rooms right now.'))]));
      msg.replaceChildren(`${rooms.length} live room${rooms.length === 1 ? '' : 's'} · ${new Date().toLocaleTimeString()}`);
    } catch (e) { showError(msg, e); }
  }
  load();
  return h('section', { class: 'card panel-dev', id: 'liveRooms' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Live rooms (Sky Crew)'), h('button', { class: 'btn small', onclick: load }, 'Refresh')),
    h('p', { class: 'small muted' }, 'Every co-op room on the game server. As Developer you can join any room, even full or locked ones. Each join is written to the audit log.'),
    h('label', { class: 'inline small' }, hidden, ' Join hidden (invisible spectator)'), msg,
    h('div', { class: 'table-wrap section-head' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Room', 'Host', 'Players', 'Route', 'Status', ''].map((c) => h('th', {}, c)))), tbody)));
}

// ---------------- Online players ----------------
function onlinePanel() {
  const msg = h('div', { 'aria-live': 'polite' });
  const minutes = h('select', { 'aria-label': 'Window', id: 'online-window' }, ...[5, 15, 60].map((m) => h('option', { value: m }, `Last ${m} min`)));
  const tbody = h('tbody');
  const roomsBox = h('div');
  let timer;
  async function load() {
    try {
      const d = await api('GET', `/api/admin/online?minutes=${minutes.value}`);
      msg.replaceChildren(h('span', { class: 'small muted' }, h('span', { class: 'dot' }), ` ${d.users.length} online on the website · updated ${new Date().toLocaleTimeString()}`));
      tbody.replaceChildren(...(d.users.length ? d.users.map((u) => h('tr', {}, h('td', {}, userChip(u)), h('td', { class: 'small muted' }, fmtDate(u.lastSeenAt)), h('td', {}, u.banned ? h('span', { class: 'pill' }, 'Banned') : h('span', { class: 'pill published' }, 'Active')))) : [h('tr', {}, h('td', { colspan: 3, class: 'muted' }, 'Nobody else right now.'))]));
      if (d.rooms) {
        roomsBox.replaceChildren(h('h3', {}, `Sky Crew rooms (${d.rooms.length})`), h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Room', 'Host', 'Players', 'Route', 'Status'].map((c) => h('th', {}, c)))),
          h('tbody', {}, ...(d.rooms.length ? d.rooms.map((r) => h('tr', {}, h('td', {}, h('strong', {}, r.code), r.locked ? ' 🔒' : ''), h('td', {}, r.host || '—'), h('td', {}, String(r.players)), h('td', {}, r.route || '—'), h('td', {}, r.phase || 'lobby')))
            : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No live rooms right now.'))])))),
          h('p', { class: 'small muted' }, 'To join a room, use the Live rooms tab.'));
      } else roomsBox.replaceChildren(h('p', { class: 'small muted' }, d.gameServer === 'not-attached' ? 'The co-op game server is not running in this process (GAME_SERVER_KEY not set), so no live rooms.' : 'Live rooms unavailable.'));
    } catch (e) { showError(msg, e); }
  }
  minutes.addEventListener('change', load);
  load();
  timer = setInterval(() => { if (!document.getElementById('online-panel')) clearInterval(timer); else load(); }, 20000);
  return h('section', { class: 'card', id: 'online-panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Online now'), minutes, h('button', { class: 'btn small', id: 'online-refresh', onclick: load }, 'Refresh')),
    h('p', { class: 'small muted' }, 'Signed-in players seen on the website or in a game in the selected window. Refreshes every 20 seconds.'), msg,
    h('div', { class: 'table-wrap section-head' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Player', 'Last seen', 'Status'].map((c) => h('th', {}, c)))), tbody)),
    roomsBox);
}

// ---------------- Site events (banner) ----------------
function toLocalInput(iso) { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function fromLocalInput(v) { return v ? new Date(v).toISOString() : undefined; }
function eventsPanel() {
  const list = h('div', { class: 'news-list', id: 'events-list' });
  const editor = h('div');
  async function load() {
    try {
      const { events } = await api('GET', '/api/dev/events');
      const now = Date.now();
      list.replaceChildren(...(events.length ? events.map((e) => {
        const state = e.cancelled ? 'cancelled' : Date.parse(e.endsAt) <= now ? 'ended' : Date.parse(e.startsAt) <= now ? 'live' : Date.parse(e.announceAt) <= now ? 'announced' : 'scheduled';
        return h('div', { class: 'card', dataset: { event: String(e.id) } },
          h('div', { class: 'panel-head' }, h('h3', {}, e.title), h('span', { class: `pill ${state === 'live' || state === 'announced' ? 'published' : state === 'scheduled' ? 'upcoming' : ''}` }, state)),
          h('p', { class: 'small muted' }, `${fmtDate(e.startsAt)} → ${fmtDate(e.endsAt)} · banner from ${fmtDate(e.announceAt)}`),
          e.message ? h('p', {}, e.message) : null,
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn small', onclick: () => edit(e) }, 'Edit'),
            !e.cancelled && state !== 'ended' ? h('button', { class: 'btn small', onclick: async () => { await api('PATCH', `/api/dev/events/${e.id}`, { cancelled: true }); load(); } }, 'Cancel event') : null,
            e.cancelled ? h('button', { class: 'btn small', onclick: async () => { await api('PATCH', `/api/dev/events/${e.id}`, { cancelled: false }); load(); } }, 'Restore') : null,
            h('button', { class: 'btn small danger', onclick: async () => { if (confirm(`Delete "${e.title}"?`)) { await api('DELETE', `/api/dev/events/${e.id}`); load(); } } }, 'Delete')));
      }) : [h('p', { class: 'muted' }, 'No events yet.')]));
    } catch (e) { showError(list, e); }
  }
  function edit(e = null) {
    const msg = h('div', { 'aria-live': 'polite' });
    const now = new Date(); const inHour = new Date(Date.now() + 3600e3); const in3 = new Date(Date.now() + 3 * 3600e3);
    const inp = (name, label, val, attrs = {}) => { const i = h('input', { id: `e-${name}`, name, ...attrs }); i.value = val ?? ''; return h('div', { class: 'field' }, h('label', { for: `e-${name}` }, label), i); };
    const style = h('select', { id: 'e-style', name: 'style' }, ...[['event', 'Event (cyan)'], ['info', 'Info (blue)'], ['warning', 'Warning (gold)']].map(([v, l]) => h('option', { value: v, selected: (e?.style ?? 'event') === v }, l)));
    const f = h('form', { class: 'card panel-dev', novalidate: true, id: 'event-form' }, h('h2', {}, e ? `Edit: ${e.title}` : 'Schedule an event'),
      inp('title', 'Title', e?.title, { maxlength: 120, required: true, placeholder: 'e.g. Double payout weekend' }),
      inp('message', 'Message (optional)', e?.message, { maxlength: 500 }),
      h('div', { class: 'form-grid' },
        inp('announceAt', 'Show banner from', toLocalInput(e?.announceAt ?? now.toISOString()), { type: 'datetime-local' }),
        inp('startsAt', 'Starts', toLocalInput(e?.startsAt ?? inHour.toISOString()), { type: 'datetime-local', required: true }),
        inp('endsAt', 'Ends', toLocalInput(e?.endsAt ?? in3.toISOString()), { type: 'datetime-local', required: true }),
        h('div', { class: 'field' }, h('label', { for: 'e-style' }, 'Style'), style)),
      inp('linkUrl', 'Link (optional)', e?.linkUrl, { placeholder: '/play/sky-crew' }),
      h('p', { class: 'small muted' }, 'Times are in your local time zone. The banner shows on every page from "Show banner from" until the event ends.'),
      msg, h('div', { class: 'inline' }, h('button', { class: 'btn primary', id: 'save-event' }, e ? 'Save' : 'Announce event'), h('button', { type: 'button', class: 'btn', onclick: () => editor.replaceChildren() }, 'Cancel')));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const body = { title: d.title, message: d.message, style: d.style, linkUrl: d.linkUrl, announceAt: fromLocalInput(d.announceAt), startsAt: fromLocalInput(d.startsAt), endsAt: fromLocalInput(d.endsAt) };
      try { if (e) await api('PATCH', `/api/dev/events/${e.id}`, body); else await api('POST', '/api/dev/events', body); showOk(msg, 'Saved. The banner appears site-wide at the scheduled time.'); load(); }
      catch (err) { showError(msg, err); }
    });
    editor.replaceChildren(h('div', { class: 'section-head' }), f);
    f.scrollIntoView({ behavior: 'smooth' });
  }
  load();
  return h('div', {}, h('div', { class: 'panel-head' }, h('h2', {}, 'Server events'), h('button', { class: 'btn primary small', id: 'new-event', onclick: () => edit() }, '+ New event')),
    h('p', { class: 'small muted' }, 'Scheduled events appear as a banner at the top of every page.'), editor, h('div', { class: 'section-head' }), list);
}

// ---------------- Maintenance mode ----------------
function sitePanel() {
  const root = h('section', { class: 'card maint-panel', id: 'maint-panel' }, h('p', { class: 'muted' }, 'Loading…'));
  async function load() {
    try {
      const m = await api('GET', '/api/dev/maintenance');
      const msg = h('div', { 'aria-live': 'polite' });
      const enabled = h('input', { type: 'checkbox', id: 'm-enabled', checked: m.enabled });
      const text = h('textarea', { id: 'm-text', maxlength: 500, placeholder: 'e.g. We are adding new planes! Back soon.' }); text.value = m.message || '';
      const eta = h('input', { id: 'm-eta-input', type: 'datetime-local' }); eta.value = toLocalInput(m.eta);
      root.classList.toggle('on', m.on);
      root.replaceChildren(
        h('div', { class: 'panel-head' }, h('h2', {}, 'Maintenance mode'), h('span', { class: `pill ${m.on ? 'upcoming' : 'published'}`, id: 'm-state' }, m.on ? 'ON' : 'OFF')),
        h('p', { class: 'small muted' }, 'While on, everyone except you (Developer) sees a "Batlas is under maintenance" page. Sign-in, sign-up and joining games are refused for everyone else. Health checks and backups keep working.'),
        m.forced ? h('div', { class: 'alert error', role: 'status' }, 'MAINTENANCE_MODE=true is set on the server, so maintenance stays ON until that environment variable is removed. You can still edit the message and ETA.') : null,
        h('label', { class: 'switch', for: 'm-enabled' }, enabled, 'Maintenance mode on'),
        h('div', { class: 'field shots-field' }, h('label', { for: 'm-text' }, 'Message for players (optional)'), text),
        h('div', { class: 'field' }, h('label', { for: 'm-eta-input' }, 'Expected back (optional)'), eta),
        msg,
        h('div', { class: 'inline' },
          h('button', { class: 'btn primary', id: 'm-save', onclick: async () => {
            if (enabled.checked && !m.enabled && !confirm('Turn maintenance mode ON? Everyone except you will be locked out until you turn it off.')) return;
            try { await api('PUT', '/api/dev/maintenance', { enabled: enabled.checked, message: text.value.trim(), eta: eta.value ? new Date(eta.value).toISOString() : null }); await load(); showOk(root.querySelector('[aria-live]'), 'Saved and audit-logged.'); }
            catch (e) { showError(msg, e); }
          } }, 'Save'),
          h('a', { class: 'btn', href: '/', target: '_blank' }, 'Open site')),
        m.updatedAt ? h('p', { class: 'small muted' }, 'Last changed ', fmtDate(m.updatedAt)) : null);
    } catch (e) { showError(root, e); }
  }
  load();
  return root;
}

// ---------------- Media library ----------------
function mediaPanel() {
  const grid = h('div', { class: 'media-grid', id: 'media-grid' });
  const info = h('span', { class: 'small muted' });
  async function load() {
    try {
      const d = await api('GET', '/api/dev/media');
      info.textContent = `${d.media.length} files · ${MB(d.totalBytes)} stored in the database`;
      grid.replaceChildren(...(d.media.length ? d.media.map((m) => h('div', { class: 'media-tile', dataset: { media: String(m.id) } },
        h('div', { class: 'pv' }, m.kind === 'video' ? h('video', { src: m.url, muted: true, playsinline: true, preload: 'metadata', controls: true }) : h('img', { src: m.url, alt: m.filename, loading: 'lazy' })),
        h('div', { class: 'mt' }, h('span', {}, `${m.filename || m.url} · ${MB(m.size)}`),
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn small', onclick: async (e) => { try { await navigator.clipboard.writeText(m.url); e.target.textContent = 'Copied'; } catch { prompt('Copy this URL:', m.url); } } }, 'Copy URL'),
            h('button', { class: 'btn small danger', onclick: async () => { if (confirm('Delete this file? Pages that use it will show a broken image.')) { await api('DELETE', `/api/dev/media/${m.id}`); load(); } } }, 'Delete'))))) : [h('p', { class: 'muted' }, 'Nothing uploaded yet.')]));
    } catch (e) { showError(grid, e); }
  }
  load();
  return h('section', { class: 'card' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Media library'), info),
    h('p', { class: 'small muted' }, 'Images (max 5 MB) and MP4 trailers (max 40 MB) are stored in the database so they survive Render redeploys.'),
    uploader({ accept: 'image/png,image/jpeg,image/webp,image/gif,video/mp4', label: 'Upload', id: 'up-media', onDone: load }), h('div', { class: 'section-head' }), grid);
}
