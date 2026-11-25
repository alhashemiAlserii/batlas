// Shared helpers for every page. No inline scripts: CSP is script-src 'self'.
import './pwa.js';

/** Safe element builder: strings become text nodes, never HTML. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

function readCookie(name) {
  return document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=').slice(1).join('=');
}
export async function csrfToken() {
  let t = readCookie('__Host-csrf') || readCookie('csrf');
  if (!t) t = (await (await fetch('/api/csrf', { credentials: 'same-origin' })).json()).csrfToken;
  return decodeURIComponent(t);
}

export async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') opts.headers['x-csrf-token'] = await csrfToken();
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const RANK_LABEL = { DEVELOPER: 'DEVELOPER', ADMIN: 'ADMIN', TRUSTED: 'TRUSTED', PLAYER: 'PLAYER' };
export function rankBadge(role) {
  const r = RANK_LABEL[role] ? role : 'PLAYER';
  return h('span', { class: `rank rank-${r.toLowerCase()}`, title: `${r} rank` }, RANK_LABEL[r]);
}
const safeImg = (u) => (typeof u === 'string' && /^\/(uploads|media)\//.test(u) ? u : '');
export function avatar(u, size = 'sm') {
  const role = (u.role || 'PLAYER').toLowerCase();
  const src = safeImg(u.avatarUrl);
  const initial = (u.displayName || u.username || '?').trim().charAt(0).toUpperCase();
  return h('span', { class: `avatar avatar-${size} ring-${role}`, 'aria-hidden': 'true' }, src ? h('img', { src, alt: '', loading: 'lazy', width: 256, height: 256 }) : initial);
}
export function userChip(u, link = true) {
  const role = (u.role || 'PLAYER').toLowerCase();
  const name = h('span', { class: `name-${role}` }, u.displayName || u.handle || u.username);
  const handle = u.handle || u.username;
  return h('span', { class: 'user-chip' }, avatar(u), link ? h('a', { href: `/u/${encodeURIComponent(handle)}` }, name) : name, rankBadge(u.role));
}

let meP;
export function getMe() {
  meP ??= Promise.all([api('GET', '/api/me'), api('GET', '/api/me/permissions')]).then(([m, p]) => ({ user: m.user, role: p.role, permissions: new Set(p.permissions) }));
  return meP;
}

export function showError(container, err) {
  container.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, err.message || String(err)));
}
export function showOk(container, msg) {
  container.replaceChildren(h('div', { class: 'alert ok', role: 'status' }, msg));
}

export function fmtDay(s) {
  if (!s) return '';
  const d = new Date(String(s).length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** "in 3 days", "in 2 h", "in 5 min" (or "" if past). */
export function timeUntil(s) {
  const ms = Date.parse(s) - Date.now();
  if (!(ms > 0)) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `in ${hrs} h`;
  return `in ${Math.round(hrs / 24)} days`;
}

/** Only same-site paths or http(s) links are ever put into href/src. */
export const safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(u) ? u : null);

const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

async function renderBanners(header, me) {
  const box = h('div', { class: 'site-banners' });
  try {
    if (me?.role === 'DEVELOPER') {
      const m = await api('GET', '/api/maintenance');
      if (m.on) box.append(h('div', { class: 'site-banner maint-on', role: 'status' }, h('strong', {}, '🛠 Maintenance mode is ON'), h('span', {}, m.forced ? 'Forced by MAINTENANCE_MODE on the server.' : 'Only you (Developer) can see the site.'), h('a', { href: '/studio-console#site' }, 'Manage')));
    }
    const { events } = await api('GET', '/api/events/active');
    // At most two banners, so small screens are not buried.
    for (const e of events.slice(0, 2)) {
      if (store.get(`ev-hide-${e.id}-${e.updatedAt}`)) continue;
      const live = Date.parse(e.startsAt) <= Date.now();
      const link = safeUrl(e.linkUrl);
      const el = h('div', { class: `site-banner ${e.style}`, role: 'region', 'aria-label': 'Event', dataset: { eventId: String(e.id) } },
        h('strong', {}, live ? '🔴 Live now: ' : '📣 ', e.title),
        e.message ? h('span', {}, e.message) : null,
        h('span', { class: 'when' }, live ? `until ${fmtDate(e.endsAt)}` : `starts ${timeUntil(e.startsAt)} · ${fmtDate(e.startsAt)}`),
        link ? h('a', { href: link }, live ? 'Join →' : 'Details →') : null,
        h('button', { class: 'x', 'aria-label': 'Dismiss', onclick: () => { store.set(`ev-hide-${e.id}-${e.updatedAt}`, '1'); el.remove(); } }, '×'));
      box.append(el);
    }
  } catch { /* banners are optional */ }
  // Below the sticky header (not inside it), so banners scroll away instead of covering the page.
  if (box.childElementCount) header.after(box);
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function HEX() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('hex');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M7.2 3.2h9.6L21 12l-4.2 8.8H7.2L3 12z');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.4');
  svg.append(p);
  return svg;
}

let passRoot = null;
export async function openPasses() {
  if (!passRoot) return;
  passRoot.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const body = passRoot.querySelector('.pass-body');
  const tabs = passRoot.querySelectorAll('[data-tab]');
  let tab = 'early_access';
  const draw = (data) => {
    tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (!data?.signedIn) {
      body.replaceChildren(h('p', { class: 'pass-empty' }, 'Sign in with your handle to see your passes.'));
      return;
    }
    const rows = (data.passes || []).filter((p) => p.kind === tab);
    const blurb = tab === 'early_access'
      ? 'A preview pass is first boarding for a new game or a test build. Staff grant it. Nothing on this list has a price.'
      : 'A crew card is a mark staff can pin on your account. It does not unlock a locked game by itself.';
    body.replaceChildren(
      h('p', { class: 'pass-blurb' }, blurb),
      rows.length
        ? h('ul', { class: 'pass-list' }, ...rows.map((p) => h('li', {},
          h('strong', {}, p.gameTitle || 'All games'),
          h('span', {}, p.active ? (p.expiresAt ? `Open until ${fmtDate(p.expiresAt)}` : 'Open, no expiry') : 'Closed'))))
        : h('p', { class: 'pass-empty' }, tab === 'early_access' ? 'No preview pass on this handle yet.' : 'No crew card on this handle yet.'));
  };
  tabs.forEach((b) => b.onclick = () => { tab = b.dataset.tab; draw(passRoot._data); });
  try {
    const data = await api('GET', '/api/passes/mine');
    passRoot._data = data;
    draw(data);
  } catch {
    body.replaceChildren(h('p', { class: 'pass-empty' }, 'Passes are unavailable right now.'));
  }
}

function mountPasses() {
  if (document.getElementById('pass-modal')) return;
  const body = h('div', { class: 'pass-body' });
  passRoot = h('div', { id: 'pass-modal', class: 'pass-modal hidden', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pass-title' },
    h('div', { class: 'pass-card' },
      h('div', { class: 'pass-top' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Batlas passes'), h('h2', { id: 'pass-title' }, 'Your passes')),
        h('button', { class: 'pass-x', type: 'button', 'aria-label': 'Close', onclick: closePasses }, '×')),
      h('div', { class: 'pass-tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', dataset: { tab: 'early_access' }, class: 'active' }, 'Preview'),
        h('button', { type: 'button', role: 'tab', dataset: { tab: 'crew' } }, 'Crew card')),
      body));
  passRoot.addEventListener('click', (e) => { if (e.target === passRoot) closePasses(); });
  document.body.append(passRoot);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && passRoot && !passRoot.classList.contains('hidden')) closePasses(); });
}
function closePasses() {
  passRoot?.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function mountFeedback() {
  if (document.getElementById('fb-fab')) return;
  const box = h('form', { class: 'fb-panel hidden', id: 'fb-panel' });
  const note = h('div');
  const msg = h('textarea', { name: 'message', maxlength: '2000', required: true, placeholder: 'What should we know?', 'aria-label': 'Feedback' });
  box.append(
    h('p', { class: 'eyebrow' }, 'Feedback'),
    h('p', { class: 'small muted' }, 'A note for the studio. Staff read these on the dashboard.'),
    msg, note,
    h('div', { class: 'hp' }, h('label', {}, 'Company', h('input', { name: 'company', tabindex: '-1', autocomplete: 'off' }))),
    h('div', { class: 'inline' },
      h('button', { class: 'btn primary small', type: 'submit' }, 'Send'),
      h('button', { class: 'btn small', type: 'button', onclick: () => box.classList.add('hidden') }, 'Close')));
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msg.value.trim();
    if (text.length < 4) { showError(note, new Error('Tell us a little more.')); return; }
    try {
      await api('POST', '/api/feedback', { message: text, page: location.pathname, company: box.company.value });
      msg.value = '';
      showOk(note, 'Sent. Thank you.');
    } catch (err) { showError(note, err); }
  });
  const fab = h('button', { id: 'fb-fab', class: 'fb-fab', type: 'button', onclick: () => box.classList.toggle('hidden') }, 'Feedback');
  document.body.append(fab, box);
}

async function gameCount() {
  try {
    const { games } = await api('GET', '/api/games');
    const auto = new Set(['highcrag']);
    const list = games.some((g) => g.slug === 'sky-crew' || !auto.has(g.slug)) ? games : [{ slug: 'sky-crew' }, ...games];
    return list.length;
  } catch { return 0; }
}

async function renderChrome() {
  const header = $('#site-header');
  const footer = $('#site-footer');
  let studio = 'Batlas';
  try { studio = (await api('GET', '/api/site')).studioName; } catch {}
  const path = location.pathname;
  const link = (href, label, extra) => h('a', { href, class: path === href || (href !== '/' && path.startsWith(href)) ? 'active' : '' }, label, extra || null);
  if (header) {
    const count = h('span', { class: 'count-badge', id: 'nav-game-count' }, '–');
    const links = h('div', { class: 'nav-links' }, link('/games', 'Games', count), link('/leaderboard', 'Leaderboard'), link('/about', 'About'));
    const right = h('div', { class: 'nav-right' });
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' },
      h('a', { class: 'brand', href: '/', 'aria-label': `${studio} home` },
        h('span', { class: 'mono' }, h('img', { src: '/img/batlas-mark.png', alt: '', width: 164, height: 120 })),
        h('span', { class: 'wordmark' }, h('b', {}, 'BATLAS'), h('span', {}, 'GAMES'))),
      h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: (e) => { const o = nav.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); e.currentTarget.textContent = o ? 'Close' : 'Menu'; } }, 'Menu'),
      links,
      right,
      h('span', { class: 'nav-tag' }, h('i', { class: 'dot', 'aria-hidden': 'true' }), 'Plays in the browser'));
    header.replaceChildren(nav);
    mountPasses();
    mountFeedback();
    right.append(
      h('span', { id: 'nav-account' }),
      h('button', { class: 'pass-pill', id: 'open-passes', type: 'button', onclick: () => openPasses() }, HEX(), 'Preview'));
    gameCount().then((n) => { count.textContent = String(n); });
    try {
      const me = await getMe();
      const slot = document.getElementById('nav-account');
      if (me.user) {
        if ((me.user.mustChangePin || me.user.mustChangePassword) && location.pathname !== '/settings') { location.href = '/settings?force=1'; return; }
        const menu = h('div', { class: 'avatar-menu hidden' },
          h('a', { href: '/profile' }, 'Profile'),
          h('a', { href: '/settings' }, 'Settings'),
          me.permissions.has('admin.panel') ? h('a', { href: '/admin' }, 'Staff desk') : null,
          h('button', { type: 'button', onclick: async () => { await api('POST', '/api/auth/logout'); location.href = '/'; } }, 'Log out'));
        const btn = h('button', { class: 'nav-avatar', type: 'button', 'aria-label': 'Account', 'aria-expanded': 'false', onclick: () => { const o = menu.classList.toggle('hidden'); btn.setAttribute('aria-expanded', String(!o)); } }, avatar(me.user, 'sm'));
        slot.replaceChildren(h('span', { class: 'avatar-wrap' }, btn, menu));
      } else {
        slot.replaceChildren(h('a', { class: 'nav-avatar', href: '/login', 'aria-label': 'Sign in' }, h('span', { class: 'avatar avatar-sm', 'aria-hidden': 'true' })));
      }
      await renderBanners(header, me);
    } catch { renderBanners(header, null); }
  }
  document.querySelectorAll('main [data-studio-name]').forEach((e) => { e.textContent = studio; });
  if (footer) {
    footer.replaceChildren(
      h('div', { class: 'inner' },
        h('div', { class: 'foot-brand' },
          h('p', { class: 'foot-word' }, 'BATLAS'),
          h('p', {}, 'Games for a crew on iPad, iPhone and Mac.')),
        h('div', { class: 'foot-right' },
          h('nav', { 'aria-label': 'Footer' },
            h('a', { href: '/terms' }, 'Terms'),
            h('a', { href: '/privacy' }, 'Privacy')),
          h('span', { class: 'legal' }, `© ${new Date().getFullYear()} ${studio}`))));
  }
}

renderChrome();
