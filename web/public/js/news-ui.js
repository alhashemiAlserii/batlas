import { h, fmtDay, userChip } from './common.js';
export function newsItem(p) {
  return h('a', { class: 'card news-item', href: `/news/${encodeURIComponent(p.slug)}` },
    h('div', { class: 'news-meta' }, p.pinned ? h('span', { class: 'pill pinned' }, '📌 Pinned') : null, h('span', {}, fmtDay(p.publishedAt))),
    h('h3', {}, p.title),
    p.summary ? h('p', { class: 'muted' }, p.summary) : null);
}
export { userChip };
