import { api, h, showError } from './common.js';
const f = document.getElementById('f');
const msg = document.getElementById('msg');
const box = document.getElementById('setup-box');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = f.querySelector('button');
  btn.disabled = true;
  const token = f['bootstrap-token'].value;
  const pin = f.pin.value;
  const pinConfirm = f['pin-confirm'].value;
  if (pin !== pinConfirm) {
    showError(msg, new Error('The PINs do not match.'));
    btn.disabled = false;
    return;
  }
  try {
    await api('POST', '/api/auth/developer-pin/bootstrap', { token, pin, pinConfirm });
    f['bootstrap-token'].value = '';
    f.pin.value = '';
    f['pin-confirm'].value = '';
    box.replaceChildren(
      h('h1', {}, 'PIN saved'),
      h('p', { class: 'alert ok', role: 'status' }, 'The Developer PIN is saved. Sign in with the handle and that PIN.'),
      h('p', {}, h('a', { class: 'btn primary', href: '/login' }, 'Log in')),
    );
  } catch (err) {
    f.pin.value = '';
    f['pin-confirm'].value = '';
    showError(msg, err);
    btn.disabled = false;
  }
});
