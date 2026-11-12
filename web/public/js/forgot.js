import { api, h, showError, showOk } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
// Email is optional on Batlas (school iPads often block it). When email sending is off,
// A forgotten PIN is reset by staff, who can issue a one-time temporary PIN.
// Email reset stays available only when the site has email turned on.
api('GET', '/api/site').then((s) => {
  if (s.emailEnabled) return;
  f.replaceWith(h('div', { class: 'alert', role: 'status' }, 'Forgot your PIN? Ask a Batlas admin. They can give you a one-time temporary PIN, and you will choose a new one when you sign in.'));
}).catch(() => {});
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await api('POST', '/api/auth/password/forgot', { email: f.email.value }); showOk(msg, r.message); }
  catch (err) { showError(msg, err); }
});
