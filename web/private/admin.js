import { h, getMe, rankBadge } from '/js/common.js';
import { usersPanel, logPanel, gameControls } from '/js/staff.js';
const app = document.getElementById('app');
const me = await getMe();
const p = me.permissions;
const cls = { DEVELOPER: 'panel-dev', ADMIN: 'panel-admin', TRUSTED: 'panel-trusted' }[me.role] || '';
const parts = [
  h('div', { class: `card ${cls}` },
    h('div', { class: 'panel-head' }, h('h1', {}, 'Admin panel'), rankBadge(me.role)),
    h('p', { class: 'muted' }, 'You only see the controls your rank allows. Every action is checked again by the server and logged.'),
    me.role === 'DEVELOPER' ? h('a', { class: 'btn primary', href: '/studio-console' }, 'Open Developer dashboard →') : null,
    me.role === 'TRUSTED' ? h('p', {}, 'As Trusted you can spawn approved items. Item spawning is mainly used in-game; a test control is below.') : null),
];
const gc = gameControls(p);
if (gc) parts.push(h('div', { class: 'section-head' }), gc);
if (p.has('players.view')) parts.push(h('div', { class: 'section-head' }), usersPanel(me.user, p));
if (p.has('moderation.view')) parts.push(h('div', { class: 'section-head' }), logPanel('Moderation history', '/api/admin/moderation'));
app.replaceChildren(...parts);
