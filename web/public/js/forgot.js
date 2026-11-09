import { api, h, showError, showOk } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
// Email is optional on Batlas (school iPads often block it). When email sending is off,
// password help comes from staff, who can issue a one-time temporary password.
api('GET', '/api/site').then((s) => {
  if (s.emailEnabled) return;
  f.replaceWith(h('div', { class: 'alert', role: 'status' }, 'Forgot your password? Ask a Batlas admin. They can give you a one-time temporary password, and you will choose a new one when you log in.'));
}).catch(() => {});
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await api('POST', '/api/auth/password/forgot', { email: f.email.value }); showOk(msg, r.message); }
  catch (err) { showError(msg, err); }
});
