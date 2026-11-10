// Touch-friendly lightbox: swipe left/right, tap the arrows, arrow keys, Esc or tap the backdrop to close.
import { h } from './common.js';

export function openLightbox(images, start = 0, opener = null) {
  let i = start;
  const img = h('img', { alt: '', draggable: 'false' });
  const count = h('div', { class: 'lb-count', 'aria-live': 'polite' });
  const many = images.length > 1;
  const show = (n) => {
    i = (n + images.length) % images.length;
    img.src = images[i].src;
    img.alt = images[i].alt || `Screenshot ${i + 1}`;
    count.textContent = many ? `${i + 1} / ${images.length}` : '';
  };
  const close = () => {
    box.remove();
    document.body.classList.remove('lb-open');
    document.removeEventListener('keydown', onKey);
    opener?.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && many) show(i + 1);
    else if (e.key === 'ArrowLeft' && many) show(i - 1);
  };
  const closeBtn = h('button', { class: 'lb-btn lb-close', 'aria-label': 'Close', onclick: close }, '✕');
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Screenshot viewer' },
    img,
    many ? h('button', { class: 'lb-btn lb-prev', 'aria-label': 'Previous screenshot', onclick: (e) => { e.stopPropagation(); show(i - 1); } }, '‹') : null,
    many ? h('button', { class: 'lb-btn lb-next', 'aria-label': 'Next screenshot', onclick: (e) => { e.stopPropagation(); show(i + 1); } }, '›') : null,
    closeBtn, count);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  // Swipe (touch + pen + mouse drag) with pointer events; falls back to touch events on old Safari.
  let x0 = null, y0 = null;
  const start_ = (x, y) => { x0 = x; y0 = y; };
  const move_ = (x) => { if (x0 != null) img.style.transform = `translateX(${(x - x0) * 0.6}px)`; };
  const end_ = (x, y) => {
    if (x0 == null) return;
    const dx = x - x0, dy = y - y0;
    img.style.transform = '';
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && many) show(i + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close(); // swipe down to close
  };
  if (window.PointerEvent) {
    img.addEventListener('pointerdown', (e) => { start_(e.clientX, e.clientY); img.setPointerCapture?.(e.pointerId); });
    img.addEventListener('pointermove', (e) => move_(e.clientX));
    img.addEventListener('pointerup', (e) => end_(e.clientX, e.clientY));
    img.addEventListener('pointercancel', () => { x0 = null; img.style.transform = ''; });
  } else {
    img.addEventListener('touchstart', (e) => start_(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    img.addEventListener('touchmove', (e) => move_(e.touches[0].clientX), { passive: true });
    img.addEventListener('touchend', (e) => end_(e.changedTouches[0].clientX, e.changedTouches[0].clientY));
  }
  show(i);
  document.body.append(box);
  document.body.classList.add('lb-open');
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
  return { close, next: () => show(i + 1), prev: () => show(i - 1) };
}
