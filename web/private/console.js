// Developer dashboard. Served only to DEVELOPER sessions (server-gated route); every API it
// calls is also Developer-only on the server.
import { api, h, getMe, rankBadge, showError, showOk, fmtDate } from '/js/common.js';
import { usersPanel, logPanel, gameControls } from '/js/staff.js';

const app = document.getElementById('app');
const me = await getMe();
const p = me.permissions;
const view = h('div');
const tabsDef = [['games', 'Games'], ['users', 'Players & ranks'], ['audit', 'Audit log'], ['tools', 'Developer tools']];
const tabs = h('div', { class: 'tabs', role: 'tablist' }, ...tabsDef.map(([k, l]) => h('button', { dataset: { k }, role: 'tab', onclick: () => show(k) }, l)));
app.replaceChildren(
  h('div', { class: 'card panel-dev' }, h('div', { class: 'panel-head' }, h('h1', {}, 'Developer dashboard'), rankBadge(me.role)),
    h('p', { class: 'muted' }, 'Owner controls for Batlas. This page is unlisted and only served to Developer accounts.')),
  tabs, view);

function show(k) {
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
  history.replaceState(null, '', `#${k}`);
  if (k === 'users') view.replaceChildren(usersPanel(me.user, p, { roles: true }));
  if (k === 'audit') view.replaceChildren(logPanel('Audit log', '/api/admin/audit', { categories: ['moderation', 'roles', 'game', 'games', 'auth'] }));
  if (k === 'games') view.replaceChildren(gamesPanel());
  if (k === 'tools') view.replaceChildren(toolsPanel());
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
    editor.replaceChildren(h('div', { class: 'section-head' }), form);
    form.scrollIntoView({ behavior: 'smooth' });
  }
  load();
  wrap.append(h('div', { class: 'panel-head' }, h('h2', {}, 'Games'), h('button', { class: 'btn primary small', onclick: () => edit() }, '+ New game')), list, editor);
  return wrap;
}

show(tabsDef.some(([k]) => `#${k}` === location.hash) ? location.hash.slice(1) : 'games');
