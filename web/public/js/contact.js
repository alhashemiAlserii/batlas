import { api, h, getMe, showError, showOk } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
const me = await getMe();
if (me.user) { f.name.value = me.user.displayName || me.user.username; f.email.value = me.user.email || ''; }
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = f.querySelector('button');
  btn.disabled = true;
  try {
    await api('POST', '/api/contact', Object.fromEntries(new FormData(f)));
    f.reset();
    showOk(msg, 'Thanks! Your message has been sent to the Batlas team.');
  } catch (err) { showError(msg, err); }
  btn.disabled = false;
});
