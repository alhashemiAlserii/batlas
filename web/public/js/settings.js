import { api, h, getMe, avatar, rankBadge, showError, showOk } from './common.js';
const root = document.getElementById('settings');
const me = await getMe();
if (!me.user) location.href = '/login?next=/settings';
else {
  const u = me.user;
  // verification
  const vMsg = h('div', { 'aria-live': 'polite' });
  const verify = h('section', { class: 'card' }, h('h2', {}, 'Email'), h('p', {}, u.email, ' ', u.emailVerified ? h('span', { class: 'pill published' }, 'Verified') : h('span', { class: 'pill upcoming' }, 'Not verified')),
    u.emailVerified ? null : h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/auth/verify-email/request', {}); showOk(vMsg, 'Verification link sent. Check your inbox.'); } catch (e) { showError(vMsg, e); } } }, 'Send verification link'), vMsg);

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

  // change password
  const pMsg = h('div', { 'aria-live': 'polite' });
  const pf = h('form', { class: 'card', novalidate: true }, h('h2', {}, 'Change password'),
    h('div', { class: 'field' }, h('label', { for: 'cp' }, 'Current password'), h('input', { id: 'cp', name: 'currentPassword', type: 'password', autocomplete: 'current-password', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'np' }, 'New password'), h('input', { id: 'np', name: 'newPassword', type: 'password', autocomplete: 'new-password', minlength: 10, required: true })),
    h('div', { class: 'field' }, h('label', { for: 'np2' }, 'Repeat new password'), h('input', { id: 'np2', name: 'np2', type: 'password', autocomplete: 'new-password', required: true })),
    h('p', { class: 'small muted' }, 'Changing your password signs you out on every other device.'), pMsg, h('button', { class: 'btn primary' }, 'Change password'));
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pf.newPassword.value !== pf.np2.value) return showError(pMsg, new Error('The new passwords do not match.'));
    try { await api('POST', '/api/me/password', { currentPassword: pf.currentPassword.value, newPassword: pf.newPassword.value }); pf.reset(); showOk(pMsg, 'Password changed. Other devices were signed out.'); }
    catch (err) { showError(pMsg, err); }
  });

  root.replaceChildren(
    h('p', { class: 'muted' }, 'Signed in as ', h('strong', {}, u.username), ' ', rankBadge(u.role), ' · ', h('a', { href: '/profile' }, 'Edit profile')),
    h('div', { class: 'settings-grid' }, av, h('div', { class: 'settings-grid' }, verify, pf)));
}
