import { api, showError, showOk } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await api('POST', '/api/auth/password/forgot', { email: f.email.value }); showOk(msg, r.message); }
  catch (err) { showError(msg, err); }
});
