import { api, h, getMe, avatar, rankBadge, showError, showOk } from './common.js';
const root = document.getElementById('settings');
const me = await getMe();
if (!me.user) location.href = '/login?next=/settings';
else {
  const u = me.user;
  const handle = u.handle || u.username;
  // optional email (+ verification only if the site has email turned on)
  let site = { emailEnabled: false };
  try { site = await api('GET', '/api/site'); } catch {}
  const vMsg = h('div', { 'aria-live': 'polite' });
  const emailIn = h('input', { id: 'em', name: 'email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com (optional)' }); emailIn.value = u.email || '';
  const emailPw = h('input', { id: 'em-pw', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', minlength: 4, maxlength: 6 });
  const verify = h('section', { class: 'card' }, h('h2', {}, 'Email (optional)'),
    h('p', { class: 'small muted' }, 'You don\'t need an email to play. If you forget your PIN, ask a Batlas admin for a temporary one.'),
    u.email ? h('p', {}, u.email, ' ', site.emailEnabled ? (u.emailVerified ? h('span', { class: 'pill published' }, 'Verified') : h('span', { class: 'pill upcoming' }, 'Not verified')) : null) : h('p', { class: 'muted' }, 'No email added.'),
    h('div', { class: 'field' }, h('label', { for: 'em' }, u.email ? 'Change email (leave empty to remove)' : 'Add an email'), emailIn),
    h('div', { class: 'field' }, h('label', { for: 'em-pw' }, 'Current PIN'), emailPw),
    h('div', { class: 'inline' },
      h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/me/email', { email: emailIn.value, currentPin: emailPw.value }); showOk(vMsg, 'Saved.'); setTimeout(() => location.reload(), 600); } catch (e) { showError(vMsg, e); } } }, 'Save email'),
      site.emailEnabled && u.email && !u.emailVerified ? h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/auth/verify-email/request', {}); showOk(vMsg, 'Verification link sent.'); } catch (e) { showError(vMsg, e); } } }, 'Send verification link') : null),
    vMsg);

  // avatar
  const aMsg = h('div', { 'aria-live': 'polite' });
  const preview = h('div', {}, avatar(u, 'lg'));
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', 'aria-label': 'Choose avatar image' });
  const av = h('section', { class: 'card' }, h('h2', {}, 'Avatar'),
    h('div', { class: 'profile-head' }, preview, h('div', {}, h('p', { class: 'small muted' }, 'PNG, JPEG, WebP or GIF up to 2 MB. Cropped to a square; photo metadata (like location) is removed.'), file,
      h('div', { class: 'inline section-head' },
        h('button', { class: 'btn primary', onclick: async () => {
          if (!file.files[0]) return showError(aMsg, new Error('Choose an image first.'));
          const fd = new FormData(); fd.append('file', file.files[0]);
          try { const r = await api('POST', '/api/me/avatar', fd); preview.replaceChildren(avatar(r.user, 'lg')); showOk(aMsg, 'Avatar updated.'); } catch (e) { showError(aMsg, e); }
        } }, 'Upload'),
        u.avatarUrl ? h('button', { class: 'btn', onclick: async () => { await api('DELETE', '/api/me/avatar'); preview.replaceChildren(avatar({ ...u, avatarUrl: '' }, 'lg')); showOk(aMsg, 'Avatar removed.'); } }, 'Remove') : null))), aMsg);

  // display name + handle
  const nMsg = h('div', { 'aria-live': 'polite' });
  const dn = h('input', { id: 'dn', name: 'displayName', maxlength: 24, autocomplete: 'nickname', value: u.displayName || '' });
  const hn = h('input', { id: 'hn', name: 'handle', maxlength: 20, autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', autocomplete: 'username', value: handle });
  const hPin = h('input', { id: 'hpin', type: 'password', inputmode: 'numeric', minlength: 4, maxlength: 6, autocomplete: 'current-password' });
  const names = h('form', { class: 'card', novalidate: true }, h('h2', {}, 'Name'),
    h('p', { class: 'small muted' }, 'Your display name is what other people see. Your handle is how you sign in.'),
    h('div', { class: 'field' }, h('label', { for: 'dn' }, 'Display name'), dn, h('p', { class: 'small muted' }, '1–24 letters, numbers, spaces, or . _ \' -')),
    h('div', { class: 'field' }, h('label', { for: 'hn' }, 'Handle'), hn, h('p', { class: 'small muted' }, '3–20 letters, numbers or _. Shown as @', handle, '.')),
    h('div', { class: 'field' }, h('label', { for: 'hpin' }, 'Current PIN (only if you change the handle)'), hPin),
    nMsg, h('button', { class: 'btn primary' }, 'Save name'));
  names.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', '/api/me', { displayName: dn.value });
      if (hn.value !== handle) await api('PATCH', '/api/me/handle', { handle: hn.value, pin: hPin.value });
      hPin.value = '';
      showOk(nMsg, 'Saved.');
      setTimeout(() => location.reload(), 600);
    } catch (err) { showError(nMsg, err); }
  });

  // change PIN
  const pMsg = h('div', { 'aria-live': 'polite' });
  const pf = h('form', { class: 'card', novalidate: true }, h('h2', {}, 'Change PIN'),
    h('div', { class: 'field' }, h('label', { for: 'cp' }, 'Current PIN'), h('input', { id: 'cp', name: 'currentPin', type: 'password', inputmode: 'numeric', minlength: 4, maxlength: 6, autocomplete: 'current-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'np' }, 'New PIN'), h('input', { id: 'np', name: 'newPin', type: 'password', inputmode: 'numeric', minlength: 4, maxlength: 6, autocomplete: 'new-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'np2' }, 'Repeat new PIN'), h('input', { id: 'np2', name: 'np2', type: 'password', inputmode: 'numeric', minlength: 4, maxlength: 6, autocomplete: 'new-password', required: true })),
    h('p', { class: 'small muted' }, 'Changing your PIN signs you out on every other device.'), pMsg, h('button', { class: 'btn primary' }, 'Change PIN'));
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pf.newPin.value !== pf.np2.value) return showError(pMsg, new Error('The new PINs do not match.'));
    try {
      await api('POST', '/api/me/pin', { currentPin: pf.currentPin.value, newPin: pf.newPin.value });
      pf.reset();
      showOk(pMsg, 'PIN changed. Other devices were signed out.');
      if (forced) setTimeout(() => { location.href = '/profile'; }, 900);
    }
    catch (err) { showError(pMsg, err); }
  });

  // delete account (danger zone)
  const dMsg = h('div', { 'aria-live': 'polite' });
  let del;
  if (u.role === 'DEVELOPER') {
    del = h('section', { class: 'card danger-zone', id: 'delete-account' }, h('h2', {}, 'Delete account'),
      h('p', { class: 'small muted' }, 'Developer accounts can\'t be deleted. Give the Developer rank to someone else first.'));
  } else {
    const dUser = h('input', { id: 'del-user', name: 'handle', type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', inputmode: 'text', placeholder: handle });
    const dPw = h('input', { id: 'del-pw', name: 'pin', type: 'password', inputmode: 'numeric', minlength: 4, maxlength: 6, autocomplete: 'current-password' });
    const dOk = h('input', { id: 'del-ok', type: 'checkbox' });
    const dBtn = h('button', { class: 'btn danger', type: 'submit', disabled: true }, 'Delete my account forever');
    const ready = () => { dBtn.disabled = !(dUser.value === handle && dPw.value && dOk.checked); };
    for (const el of [dUser, dPw, dOk]) { el.addEventListener('input', ready); el.addEventListener('change', ready); }
    del = h('form', { class: 'card danger-zone', id: 'delete-account', novalidate: true }, h('h2', {}, 'Delete account'),
      h('p', { class: 'small' }, 'This permanently deletes your Batlas account: your profile, avatar, flight scores and sign-ins on every device. It cannot be undone, and nobody (not even staff) can bring it back.'),
      h('p', { class: 'small muted' }, 'News posts or uploads you made stay on the site without your name. Staff records of past actions are kept but your name in them is replaced with "deleted-user".'),
      h('div', { class: 'field' }, h('label', { for: 'del-user' }, 'Type your handle ', h('strong', {}, handle), ' to confirm'), dUser),
      h('div', { class: 'field' }, h('label', { for: 'del-pw' }, 'Current PIN'), dPw),
      h('label', { class: 'checks small', for: 'del-ok' }, dOk, ' I understand my account will be gone for good.'),
      dMsg, dBtn);
    del.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (dUser.value !== handle) return showError(dMsg, new Error(`Type your handle exactly: ${handle}`));
      if (!window.confirm(`Really delete the account @${handle}? This cannot be undone.`)) return;
      dBtn.disabled = true;
      try {
        await api('POST', '/api/me/delete', { handle: dUser.value, pin: dPw.value });
        root.replaceChildren(h('div', { class: 'alert ok', role: 'status' }, 'Your account has been deleted. Goodbye from Batlas.'), h('p', {}, h('a', { class: 'btn', href: '/' }, 'Back to the home page')));
        setTimeout(() => { location.href = '/'; }, 4000);
      } catch (err) { dPw.value = ''; ready(); showError(dMsg, err); }
    });
  }

  const forced = !!(u.mustChangePin || u.mustChangePassword);
  if (forced) {
    pf.querySelector('label[for=cp]').textContent = 'Temporary PIN (the one staff gave you)';
    root.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, 'A Batlas staff member reset your PIN. Choose your own new PIN to continue.'), pf);
  } else root.replaceChildren(
    h('p', { class: 'muted' }, 'Signed in as ', h('strong', {}, u.displayName || handle), ' ', h('span', { class: 'small' }, '@', handle), ' ', rankBadge(u.role), ' · ', h('a', { href: '/profile' }, 'View profile')),
    h('div', { class: 'settings-grid' }, names, av, h('div', { class: 'settings-grid' }, verify, pf)),
    del);
}
