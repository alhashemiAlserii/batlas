// Shared helpers for every page. No inline scripts: CSP is script-src 'self'.

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
  const name = h('span', { class: `name-${role}` }, u.displayName || u.username);
  return h('span', { class: 'user-chip' }, avatar(u), link ? h('a', { href: `/u/${encodeURIComponent(u.username)}` }, name) : name, rankBadge(u.role));
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

async function renderChrome() {
  const header = $('#site-header');
  const footer = $('#site-footer');
  let studio = 'Batlas';
  try { studio = (await api('GET', '/api/site')).studioName; } catch {}
  const path = location.pathname;
  const link = (href, label) => h('a', { href, class: path === href || (href !== '/' && path.startsWith(href)) ? 'active' : '' }, label);
  if (header) {
    const right = h('div', { class: 'nav-right' });
    const links = h('div', { class: 'nav-links' }, link('/', 'Home'), link('/games', 'Games'), link('/news', 'News'), link('/contact', 'Contact'));
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' },
      h('a', { class: 'brand', href: '/', 'aria-label': `${studio} home` }, h('img', { class: 'brand-mark', src: '/img/batlas-mark.png', alt: '', width: 164, height: 120 }), h('span', { class: 'sr-only', 'data-studio-name': '' }, studio),
        null),
      h('button', { class: 'menu-btn', 'aria-label': 'Menu', 'aria-expanded': 'false', onclick: (e) => { const o = nav.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); } }, '☰'),
      links, right);
    header.replaceChildren(nav);
    try {
      const me = await getMe();
      if (me.user) {
        if (me.user.mustChangePassword && location.pathname !== '/settings') { location.href = '/settings?force=1'; return; }
        if (me.permissions.has('admin.panel')) links.append(link('/admin', 'Admin'));
        right.append(
          h('a', { href: '/profile' }, userChip(me.user, false)),
          h('a', { class: 'btn small', href: '/settings' }, 'Settings'),
          h('button', { class: 'btn small', onclick: async () => { await api('POST', '/api/auth/logout'); location.href = '/'; } }, 'Log out'),
        );
      } else {
        right.append(h('a', { class: 'btn small', href: '/login' }, 'Log in'), h('a', { class: 'btn small primary', href: '/register' }, 'Create account'));
      }
      await renderBanners(header, me);
    } catch { renderBanners(header, null); }
  }
  document.querySelectorAll('main [data-studio-name]').forEach((e) => { e.textContent = studio; });
  if (footer) {
    footer.replaceChildren(
      h('div', { class: 'cols' },
        h('div', { class: 'foot-brand' }, h('img', { src: '/img/batlas-mark.png', alt: studio, width: 164, height: 120 }), h('p', { class: 'small' }, 'Chaotic co-op games you play with friends, right in your browser. One account for every game.')),
        h('nav', { 'aria-label': 'Footer' }, h('h4', {}, 'Explore'), h('a', { href: '/games' }, 'Games'), h('a', { href: '/news' }, 'News'), h('a', { href: '/play/sky-crew' }, 'Play Sky Crew')),
        h('div', {}, h('h4', {}, 'Studio'), h('a', { href: '/contact' }, 'Contact'), h('a', { href: '/register' }, 'Create account'), h('a', { href: '/login' }, 'Log in'))),
      h('div', { class: 'inner' },
        h('span', {}, `© ${new Date().getFullYear()} `, studio, '. All rights reserved.'),
        h('span', {}, h('a', { href: '/games' }, 'Games'), ' · ', h('a', { href: '/contact' }, 'Contact'))));
  }
}

renderChrome();
