import { api, h, showError, showOk } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
const token = new URLSearchParams(location.search).get('token') || '';
// remove the token from the address bar / history once read
history.replaceState(null, '', '/reset-password');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (f.password.value !== f.password2.value) return showError(msg, new Error('The passwords do not match.'));
  try {
    await api('POST', '/api/auth/password/reset', { token, password: f.password.value });
    showOk(msg, 'Password changed. All devices were signed out.');
    f.replaceChildren(msg, h('a', { class: 'btn primary w100', href: '/login' }, 'Log in'));
  } catch (err) { showError(msg, err); }
});
