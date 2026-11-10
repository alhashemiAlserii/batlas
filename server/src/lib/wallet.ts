// Sky Crew wallet: balances, an idempotent ledger, owned items. Every change runs in ONE transaction,
// balances can never go negative (conditional UPDATE), and each (user, kind, ref) can only be applied once.
import type { Knex } from 'knex';
import crypto from 'node:crypto';
import { ITEM_BY_KEY, STARTER_KEYS, CATALOG } from '../game-server/shop.js';

export interface Owned { all: boolean; keys: string[] }
const now = () => new Date().toISOString();

async function ensureWallet(db: Knex | Knex.Transaction, userId: number) {
  await db('wallets').insert({ user_id: userId, balance: 0, updated_at: now() }).onConflict('user_id').ignore();
}
export async function balanceOf(db: Knex, userId: number): Promise<number> {
  const w = await db('wallets').where({ user_id: userId }).first();
  return Number(w?.balance ?? 0);
}
/** Owned item keys (starters included). The Developer owns everything. */
export async function ownedItems(db: Knex, userId: number, role: string): Promise<Owned> {
  if (role === 'DEVELOPER') return { all: true, keys: CATALOG.map((i) => i.key) };
  const rows = await db('owned_items').where({ user_id: userId }).select('item_key');
  return { all: false, keys: [...new Set([...STARTER_KEYS, ...rows.map((r) => String(r.item_key))])] };
}
export const ownsFn = (o: Owned) => { const s = new Set(o.keys); return (k: string) => o.all || s.has(k); };

export type LedgerResult = { ok: true; balance: number; delta: number; duplicate?: boolean } | { ok: false; code: 'insufficient_funds' | 'duplicate'; balance: number };

/** Apply one ledger entry atomically. Duplicate (user, kind, ref) returns the original result without changing anything. */
export async function applyLedger(db: Knex, userId: number, delta: number, kind: string, ref: string, details: Record<string, unknown> = {}, extra?: (trx: Knex.Transaction) => Promise<void>): Promise<LedgerResult> {
  delta = Math.trunc(delta);
  try {
    return await db.transaction(async (trx) => {
      const dup = await trx('wallet_ledger').where({ user_id: userId, kind, ref }).first();
      if (dup) return { ok: true as const, balance: Number(dup.balance_after), delta: Number(dup.delta), duplicate: true };
      await ensureWallet(trx, userId);
      const n = await trx('wallets').where({ user_id: userId }).andWhere('balance', '>=', -delta).update({ balance: trx.raw('balance + ?', [delta]), updated_at: now() });
      if (!n) { const w = await trx('wallets').where({ user_id: userId }).first(); throw Object.assign(new Error('insufficient'), { walletResult: { ok: false as const, code: 'insufficient_funds' as const, balance: Number(w?.balance ?? 0) } }); }
      const w = await trx('wallets').where({ user_id: userId }).first();
      const balance = Number(w.balance);
      if (balance < 0) throw new Error('negative balance'); // belt and braces: the conditional update already prevents it
      await trx('wallet_ledger').insert({ user_id: userId, delta, balance_after: balance, kind, ref, details: JSON.stringify(details), created_at: now() });
      if (extra) await extra(trx);
      return { ok: true as const, balance, delta };
    });
  } catch (e) {
    const wr = (e as { walletResult?: LedgerResult }).walletResult;
    if (wr) return wr;
    // a concurrent request with the same (user, kind, ref) won the race: report it as a duplicate
    const dup = await db('wallet_ledger').where({ user_id: userId, kind, ref }).first();
    if (dup) return { ok: true, balance: Number(dup.balance_after), delta: Number(dup.delta), duplicate: true };
    throw e;
  }
}

export type BuyResult = { ok: true; balance: number; item: string; already?: boolean } | { ok: false; code: 'unknown_item' | 'insufficient_funds'; balance: number; price?: number };
/** Buy one catalogue item. Idempotent: a retried purchase id is a no-op, and an owned item is never charged twice
 * (the owned_items primary key is inserted in the SAME transaction as the debit, so a race rolls one back). */
export async function buyItem(db: Knex, userId: number, role: string, key: string, purchaseId: string): Promise<BuyResult> {
  const item = ITEM_BY_KEY.get(key);
  const bal = await balanceOf(db, userId);
  if (!item) return { ok: false, code: 'unknown_item', balance: bal };
  const owns = ownsFn(await ownedItems(db, userId, role));
  if (owns(key)) return { ok: true, balance: bal, item: key, already: true };
  try {
    const r = await applyLedger(db, userId, -item.price, 'purchase', `${key}#${purchaseId.slice(0, 64)}`, { item: key, price: item.price, purchaseId: purchaseId.slice(0, 64) }, async (trx) => {
      await trx('owned_items').insert({ user_id: userId, item_key: key, source: 'purchase', created_at: now() });
    });
    if (!r.ok) return { ok: false, code: 'insufficient_funds', balance: r.balance, price: item.price };
    return { ok: true, balance: r.balance, item: key, already: !!r.duplicate };
  } catch {
    // concurrent purchase of the same item: the other one charged; this one rolled back
    return { ok: true, balance: await balanceOf(db, userId), item: key, already: true };
  }
}

/** Developer grant/removal of credits or items. Credits removal never goes below zero. */
export async function grant(db: Knex, userId: number, op: { credits?: number; item?: string; remove?: boolean }, actor: string) {
  const out: { balance: number; credits?: number; item?: string; removed?: boolean } = { balance: await balanceOf(db, userId) };
  if (op.credits) {
    let delta = Math.trunc(op.credits);
    if (delta < 0) delta = -Math.min(-delta, out.balance);
    if (delta) { const r = await applyLedger(db, userId, delta, delta > 0 ? 'grant' : 'revoke', crypto.randomUUID(), { by: actor }); if (r.ok) out.balance = r.balance; }
    out.credits = delta;
  }
  if (op.item) {
    if (!ITEM_BY_KEY.has(op.item)) throw new Error('unknown item');
    if (op.remove) { await db('owned_items').where({ user_id: userId, item_key: op.item }).delete(); out.removed = true; }
    else await db('owned_items').insert({ user_id: userId, item_key: op.item, source: 'grant', created_at: now() }).onConflict(['user_id', 'item_key']).ignore();
    out.item = op.item;
  }
  return out;
}
export async function recentLedger(db: Knex, userId: number, limit = 20) {
  const rows = await db('wallet_ledger').where({ user_id: userId }).orderBy('id', 'desc').limit(limit);
  return rows.map((r) => ({ delta: Number(r.delta), balance: Number(r.balance_after), kind: r.kind, ref: r.ref, at: r.created_at, details: (() => { try { return JSON.parse(r.details || '{}'); } catch { return {}; } })() }));
}
