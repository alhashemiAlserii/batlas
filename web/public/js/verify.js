import { api, h, showError } from './common.js';
const msg = document.getElementById('msg');
const token = new URLSearchParams(location.search).get('token') || '';
history.replaceState(null, '', '/verify-email');
try {
  await api('POST', '/api/auth/verify-email/confirm', { token });
  msg.replaceChildren(h('div', { class: 'alert ok' }, 'Your email is verified. Thanks!'), h('a', { class: 'btn primary', href: '/profile' }, 'Go to your profile'));
} catch (err) {
  showError(msg, err);
  msg.append(h('p', { class: 'small muted' }, 'You can request a new link from ', h('a', { href: '/settings' }, 'Account settings'), '.'));
}
