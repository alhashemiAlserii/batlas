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
    await api('POST', isRegister ? '/api/auth/register' : '/api/auth/login', data);
    location.href = dest;
  } catch (err) {
    showError(msg, err);
    btn.disabled = false;
  }
});
