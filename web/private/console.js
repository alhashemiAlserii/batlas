// Developer dashboard. Served only to DEVELOPER sessions (server-gated route); every API it
// calls is also Developer-only on the server.
import { api, h, getMe, rankBadge, showError, showOk, fmtDate, fmtDay } from '/js/common.js';
import { usersPanel, logPanel, gameControls } from '/js/staff.js';

const app = document.getElementById('app');
const me = await getMe();
const p = me.permissions;
const view = h('div');
const tabsDef = [['stats', 'Stats'], ['games', 'Games'], ['news', 'News'], ['inbox', 'Inbox'], ['users', 'Players & ranks'], ['audit', 'Audit log'], ['tools', 'Developer tools']];
const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...tabsDef.map(([k, l]) => h('button', { dataset: { k }, role: 'tab', onclick: () => show(k) }, l)));
app.replaceChildren(
  h('div', { class: 'card panel-dev' }, h('div', { class: 'panel-head' }, h('h1', {}, 'Developer dashboard'), rankBadge(me.role)),
    h('p', { class: 'muted' }, 'Owner controls for Batlas. This page is unlisted and only served to Developer accounts.')),
  tabs, view);

function show(k) {
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
  history.replaceState(null, '', `#${k}`);
  if (k === 'users') view.replaceChildren(usersPanel(me.user, p, { roles: true }));
  if (k === 'audit') view.replaceChildren(logPanel('Audit log', '/api/admin/audit', { categories: ['moderation', 'roles', 'game', 'games', 'news', 'auth', 'admin'] }));
  if (k === 'games') view.replaceChildren(gamesPanel());
  if (k === 'tools') view.replaceChildren(toolsPanel());
  if (k === 'stats') view.replaceChildren(statsPanel());
  if (k === 'news') view.replaceChildren(newsPanel());
  if (k === 'inbox') view.replaceChildren(inboxPanel());
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

function gamesPanel() {
  const wrap = h('div');
  const list = h('div', { class: 'grid' });
  const editor = h('div');
  async function load() {
    try {
      const { games } = await api('GET', '/api/dev/games');
      list.replaceChildren(...(games.length ? games.map((g) => h('div', { class: 'card' },
        h('div', { class: 'panel-head' }, h('h3', {}, g.title), h('span', { class: `pill ${g.status}` }, g.status)),
        h('p', { class: 'small muted' }, `/${g.slug} · v${g.version || '—'} · updated ${fmtDate(g.updatedAt)}`),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', onclick: () => edit(g) }, 'Edit'),
          ...['draft', 'upcoming', 'published'].filter((s) => s !== g.status).map((s) => h('button', { class: 'btn small', onclick: async () => { await api('POST', `/api/dev/games/${g.id}/publish`, { status: s }); load(); } }, s === 'published' ? 'Publish' : `Set ${s}`)),
          g.status !== 'draft' ? h('a', { class: 'btn small', href: `/games/${g.slug}`, target: '_blank' }, 'View') : null))) : [h('p', { class: 'muted' }, 'No games yet. Create your first one.')]));
    } catch (e) { showError(list, e); }
  }
  function field(name, labelTxt, value = '', opts = {}) {
    const id = `g-${name}`;
    const input = opts.textarea ? h('textarea', { id, name }) : h('input', { id, name, ...opts.attrs });
    input.value = value ?? '';
    return h('div', { class: 'field' }, h('label', { for: id }, labelTxt), input, opts.hint ? h('p', { class: 'small muted' }, opts.hint) : null);
  }
  function edit(g = null) {
    const msg = h('div', { 'aria-live': 'polite' });
    const status = h('select', { id: 'g-status', name: 'status' }, ...['draft', 'upcoming', 'published'].map((s) => h('option', { value: s, selected: (g?.status || 'draft') === s }, s)));
    const upMsg = h('span', { class: 'small muted' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    const form = h('form', { class: 'card panel-dev', novalidate: true },
      h('h2', {}, g ? `Edit: ${g.title}` : 'New game'),
      field('title', 'Title', g?.title, { attrs: { required: true, maxlength: 120 } }),
      field('slug', 'URL slug', g?.slug, { attrs: { required: true, pattern: '[a-z0-9-]+' }, hint: 'lowercase-with-dashes, used in /games/<slug>' }),
      field('tagline', 'Tagline', g?.tagline),
      field('description', 'Description', g?.description, { textarea: true }),
      h('div', { class: 'field' }, h('label', { for: 'g-status' }, 'Status'), status),
      field('version', 'Version', g?.version, { hint: 'e.g. 0.1.0' }),
      field('platforms', 'Platforms', g?.platforms?.join(', '), { hint: 'comma separated, e.g. Web, Windows, Android, iOS' }),
      field('coverImage', 'Cover image URL', g?.coverImage),
      h('div', { class: 'field' }, h('label', {}, 'Upload image'), h('div', { class: 'inline' }, file,
        h('button', { type: 'button', class: 'btn small', onclick: async () => {
          if (!file.files[0]) return;
          const fd = new FormData(); fd.append('file', file.files[0]);
          try {
            const { url } = await api('POST', '/api/dev/uploads', fd);
            if (!form.coverImage.value) form.coverImage.value = url;
            else form.screenshots.value = [form.screenshots.value, url].filter(Boolean).join('\n');
            upMsg.textContent = `Uploaded ${url}`;
          } catch (e) { upMsg.textContent = e.message; }
        } }, 'Upload'), upMsg), h('p', { class: 'small muted' }, 'First upload fills the cover; later ones are added to screenshots. PNG/JPEG/WebP/GIF, max 5 MB.')),
      field('screenshots', 'Screenshot URLs (one per line)', g?.screenshots?.join('\n'), { textarea: true }),
      field('trailerUrl', 'Trailer URL', g?.trailerUrl, { hint: 'YouTube, Vimeo, or .mp4/.webm link' }),
      field('playUrl', 'Play-in-browser URL', g?.playUrl),
      field('downloadUrl', 'Download URL', g?.downloadUrl),
      msg,
      h('div', { class: 'inline' }, h('button', { class: 'btn primary' }, g ? 'Save changes' : 'Create game'), h('button', { type: 'button', class: 'btn', onclick: () => editor.replaceChildren() }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      delete d.file;
      const body = { ...d, platforms: d.platforms.split(',').map((s) => s.trim()).filter(Boolean), screenshots: d.screenshots.split('\n').map((s) => s.trim()).filter(Boolean) };
      try {
        if (g) await api('PATCH', `/api/dev/games/${g.id}`, body); else await api('POST', '/api/dev/games', body);
        showOk(msg, 'Saved. Changes are live on the site immediately (no rebuild needed).');
        load();
      } catch (err) { showError(msg, err); }
    });
    editor.replaceChildren(...[h('div', { class: 'section-head' }), form, g ? versionsEditor(g) : null].filter(Boolean));
    form.scrollIntoView({ behavior: 'smooth' });
  }
  load();
  wrap.append(h('div', { class: 'panel-head' }, h('h2', {}, 'Games'), h('button', { class: 'btn primary small', onclick: () => edit() }, '+ New game')), list, editor);
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
      h('input', { name: 'version', placeholder: 'Version, e.g. 0.2.0', 'aria-label': 'Version', required: true }),
      h('input', { name: 'releasedAt', type: 'date', value: today, 'aria-label': 'Release date', required: true })),
    h('div', { class: 'field section-head' }, h('label', { for: 'v-cl' }, 'Changelog'), h('textarea', { id: 'v-cl', name: 'changelog', placeholder: '- New: luggage physics\n- Fixed: wobbly service cart' })),
    h('div', { class: 'field' }, h('label', { for: 'v-dl' }, 'Download URL (optional)'), h('input', { id: 'v-dl', name: 'downloadUrl' })),
    msg, h('button', { class: 'btn primary' }, 'Add version'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/api/dev/games/${g.id}/versions`, Object.fromEntries(new FormData(f))); f.reset(); f.releasedAt.value = today; showOk(msg, 'Version added. The game page now shows it as the latest.'); load(); }
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
    const f = h('form', { class: 'card panel-dev', novalidate: true }, h('h2', {}, p ? `Edit: ${p.title}` : 'New announcement'),
      inp('title', 'Title', p?.title, { maxlength: 160, required: true }),
      inp('slug', 'URL slug', p?.slug, { pattern: '[a-z0-9-]+', required: true }),
      inp('summary', 'Summary (shown in lists)', p?.summary, { maxlength: 300 }),
      h('div', { class: 'field' }, h('label', { for: 'n-body' }, 'Body'), body),
      inp('coverImage', 'Cover image URL (optional; upload in Games → Upload image)', p?.coverImage),
      h('div', { class: 'inline' }, h('label', { for: 'n-status' }, 'Status'), status, h('label', { for: 'n-pinned', class: 'inline' }, pinned, ' Pin to top')),
      msg, h('div', { class: 'inline section-head' }, h('button', { class: 'btn primary' }, p ? 'Save' : 'Create'), h('button', { type: 'button', class: 'btn', onclick: () => editor.replaceChildren() }, 'Cancel')));
    const title = f.querySelector('#n-title'), slug = f.querySelector('#n-slug');
    if (!p) title.addEventListener('input', () => { slug.value = title.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const payload = { title: d.title, slug: d.slug, summary: d.summary, body: d.body, coverImage: d.coverImage, status: d.status, pinned: pinned.checked };
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
      h('p', { class: 'small muted' }, m.name, ' · ', h('a', { href: `mailto:${encodeURIComponent(m.email).replace('%40', '@')}` }, m.email), ' · ', fmtDate(m.createdAt)),
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
