import { api, showError } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = f.querySelector('button');
  btn.disabled = true;
  if (f.pin.value !== f.pin2.value) { showError(msg, new Error('The PINs do not match.')); btn.disabled = false; return; }
  try {
    await api('POST', '/api/auth/pin/setup', { login: f.login.value, currentPassword: f.currentPassword.value, pin: f.pin.value });
    f.currentPassword.value = '';
    f.pin.value = '';
    f.pin2.value = '';
    location.href = '/profile';
  } catch (err) {
    showError(msg, err);
    btn.disabled = false;
  }
});
