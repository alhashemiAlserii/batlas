// Shop & locker: outfits, hats, colours (cosmetics) and classes. Prices, balances and ownership come from the
// SERVER (/api/game/sky-crew/wallet); buying, wearing and picking a class are all re-checked there.
import { api } from '/js/common.js';
import { el } from './ui.js';
import { OUTFIT_PALETTE, CREW_SKINS } from './characters.js';
import { CLASS_INFO } from './perks.js';

const $ = (s) => document.querySelector(s);
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
export const wallet = { loaded: false, signedIn: false, balance: 0, owned: new Set(), ownsAll: false, catalog: [], ledger: [] };
const st = { tab: 'outfit', busy: false };
export const fmtC = (n) => `₵${Math.round(n).toLocaleString('en-US')}`;
export const owns = (key) => wallet.ownsAll || wallet.owned.has(key) || wallet.catalog.find((i) => i.key === key)?.price === 0;

export async function loadWallet() {
  try {
    const w = await api('GET', '/api/game/sky-crew/wallet');
    Object.assign(wallet, { loaded: true, signedIn: true, balance: w.balance, owned: new Set(w.owned), ownsAll: !!w.ownsAll, catalog: w.catalog, ledger: w.ledger });
  } catch { wallet.loaded = true; wallet.signedIn = false; }
  return wallet;
}
const newPurchaseId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

/**
 * ctx: { outfit, setOutfit(o), klass, pickClass(id) -> Promise, inRoom, phase, toast(msg, kind), onBalance() }
 */
export function renderShop(ctx) {
  const tabs = [['outfit', '👕 Outfits'], ['hat', '🎩 Hats'], ['color', '🎨 Colours'], ['class', '⭐ Classes'], ['wallet', '💳 Wallet']];
  $('#shopBal').textContent = wallet.signedIn ? (wallet.ownsAll ? `${fmtC(wallet.balance)} · Developer: everything unlocked` : fmtC(wallet.balance)) : 'Guest';
  $('#shopTabs').replaceChildren(...tabs.map(([id, l]) => el('button', { type: 'button', class: id === st.tab ? 'on' : '', 'data-tab': id, role: 'tab', 'aria-selected': String(id === st.tab), onclick: () => { st.tab = id; renderShop(ctx); } }, l)));
  const body = $('#shopBody');
  const items = wallet.catalog.filter((i) => i.kind === st.tab);
  const o = ctx.outfit;
  const card = (i, wearing, action) => {
    const own = owns(i.key);
    const btn = !wallet.signedIn && i.price > 0 ? el('span', { class: 'muted small' }, 'Sign in to buy')
      : !own ? el('button', { type: 'button', class: 'gold', 'data-buy': i.key, disabled: st.busy || wallet.balance < i.price ? '' : null, onclick: () => buy(i, ctx) }, `Buy ${fmtC(i.price)}`)
        : wearing ? el('span', { class: 'chip on' }, '✓ On') : el('button', { type: 'button', 'data-use': i.key, onclick: action }, i.kind === 'class' ? 'Pick' : 'Wear');
    const sw = i.kind === 'color' ? el('span', { class: 'swatch', 'data-color': i.id }) : el('span', { class: 'invicon' }, i.icon);
    if (i.kind === 'color') sw.style.background = hex(OUTFIT_PALETTE[Number(i.id)] ?? 0); // CSSOM (CSP-safe)
    return el('div', { class: `shopcard${wearing ? ' on' : ''}${own ? ' owned' : ''}`, 'data-item': i.key }, sw,
      el('div', { class: 'invtxt' }, el('b', {}, i.name), el('span', { class: 'muted small' }, i.kind === 'class' ? i.description : own ? (i.price ? 'Owned' : 'Free starter') : `${fmtC(i.price)}`)), btn);
  };
  let content = [];
  if (!wallet.signedIn) content.push(el('p', { class: 'muted small' }, 'Playing as a guest: free starter items only. Sign in to earn a salary and shop.'));
  if (st.tab === 'outfit') content.push(el('div', { class: 'shopgrid' }, ...items.map((i) => card(i, o.outfit === i.id, () => ctx.setOutfit({ ...o, outfit: i.id })))));
  if (st.tab === 'hat') content.push(el('div', { class: 'shopgrid' }, ...items.map((i) => card(i, o.hat === i.id, () => ctx.setOutfit({ ...o, hat: i.id })))));
  if (st.tab === 'color') {
    content.push(el('div', { class: 'shopgrid' }, ...items.map((i) => card(i, o.color === Number(i.id), () => ctx.setOutfit({ ...o, color: Number(i.id) })))));
    const skins = el('div', { class: 'skinrow' }, ...CREW_SKINS.map((c, k) => { const b = el('button', { type: 'button', class: `swatch${o.skin === k ? ' on' : ''}`, 'data-skin': String(k), 'aria-label': `Skin tone ${k + 1}`, onclick: () => ctx.setOutfit({ ...o, skin: k }) }); b.style.background = hex(c); return b; }));
    content.push(el('h4', {}, 'Skin tone (always free)'), skins);
  }
  if (st.tab === 'class') {
    const locked = ctx.inRoom && ['climb', 'cruise', 'approach'].includes(ctx.phase);
    content.push(el('p', { class: 'muted small' }, locked ? 'Classes are picked before takeoff: your pick applies from the next flight.' : 'Bought once, yours forever. Pick one before each flight: the badge shows above your head.'));
    content.push(el('div', { class: 'shopgrid' }, ...items.map((i) => card({ ...i, icon: CLASS_INFO[i.id]?.icon || i.icon }, ctx.klass === i.id, locked ? () => ctx.toast('Pick your class before takeoff.') : () => ctx.pickClass(i.id)))));
    if (ctx.klass && !locked) content.push(el('div', { class: 'admgrid' }, el('button', { type: 'button', 'data-use': 'class:none', onclick: () => ctx.pickClass(null) }, 'Fly without a class')));
  }
  if (st.tab === 'wallet') {
    content.push(el('div', { class: 'walletbig' }, el('span', { class: 'muted small' }, 'Balance'), el('b', {}, fmtC(wallet.balance))));
    content.push(el('p', { class: 'muted small' }, 'Every crew member is paid a salary after each online flight (computed and checked by the game server). Solo flights do not pay: create an online room, even just for yourself.'));
    const rows = wallet.ledger.map((l) => el('div', { class: 'admrow' }, el('span', {}, `${l.kind === 'salary' ? '💼 Salary' : l.kind === 'purchase' ? `🛍 ${wallet.catalog.find((i) => i.key === l.details?.item)?.name || l.details?.item || 'Purchase'}` : l.kind === 'grant' ? '🎁 Gift from the Developer' : '➖ Adjusted by the Developer'} · ${new Date(l.at).toLocaleDateString()}`), el('b', { class: l.delta >= 0 ? 'pos' : 'neg' }, `${l.delta >= 0 ? '+' : ''}${fmtC(l.delta)}`)));
    content.push(el('h4', {}, 'History'), ...(rows.length ? rows : [el('p', { class: 'muted small' }, 'Nothing yet. Fly an online flight to earn your first salary!')]));
  }
  body.replaceChildren(...content);
}
async function buy(i, ctx) {
  if (st.busy) return; st.busy = true; $('#shopMsg').textContent = `Buying ${i.name}…`;
  try {
    const r = await api('POST', '/api/game/sky-crew/shop/buy', { item: i.key, purchaseId: newPurchaseId() });
    wallet.balance = r.balance; wallet.owned.add(i.key);
    $('#shopMsg').textContent = r.already ? `You already own ${i.name}.` : `Bought ${i.name}! New balance ${fmtC(r.balance)}.`;
    await loadWallet();
    ctx.onBalance?.();
  } catch (e) { $('#shopMsg').textContent = e.message || 'Purchase failed.'; }
  st.busy = false; renderShop(ctx);
}
export const shopState = st;
