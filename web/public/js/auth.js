import { api, h, showError } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
const isRegister = location.pathname.startsWith('/register');
const next = new URLSearchParams(location.search).get('next');
const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/profile';
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = f.querySelector('button');
  btn.disabled = true;
  const data = Object.fromEntries(new FormData(f));
  try {
    if (!data.email) delete data.email;
    if (!data.displayName) delete data.displayName;
    if (data.pin2 != null && data.pin2 !== data.pin) throw new Error('The PINs do not match.');
    delete data.pin2;
    const r = await api('POST', isRegister ? '/api/auth/register' : '/api/auth/login', data);
    location.href = r.user?.mustChangePin || r.user?.mustChangePassword ? '/settings?force=1' : dest;
  } catch (err) {
    if (err?.data?.code === 'pin_setup_required') {
      msg.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, err.message + ' ', h('a', { href: '/set-pin' }, 'Set a PIN')));
    } else showError(msg, err);
    btn.disabled = false;
  }
});
