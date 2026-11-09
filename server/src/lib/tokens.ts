import type { Ctx } from './types.js';
import { randomToken, sha256 } from './crypto.js';

export type TokenPurpose = 'verify_email' | 'reset_password';
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000, // 24 hours
  reset_password: 60 * 60 * 1000, // 1 hour
};

/** Issues a new token; any earlier unused token for the same purpose is revoked. Returns the raw token (only ever emailed). */
export async function issueToken(ctx: Ctx, userId: number, purpose: TokenPurpose, email: string): Promise<string> {
  const now = new Date().toISOString();
  await ctx.db('auth_tokens').where({ user_id: userId, purpose }).whereNull('used_at').update({ used_at: now });
  const token = randomToken(32);
  await ctx.db('auth_tokens').insert({
    token_hash: sha256(token),
    user_id: userId,
    purpose,
    email,
    created_at: now,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS[purpose]).toISOString(),
  });
  return token;
}

/** Atomically marks a token used. Returns its row only if it was valid, unused and unexpired. */
export async function consumeToken(ctx: Ctx, token: string, purpose: TokenPurpose) {
  const hash = sha256(token);
  const now = new Date().toISOString();
  const n = await ctx
    .db('auth_tokens')
    .where({ token_hash: hash, purpose })
    .whereNull('used_at')
    .andWhere('expires_at', '>', now)
    .update({ used_at: now });
  if (n !== 1) return null;
  return ctx.db('auth_tokens').where({ token_hash: hash }).first();
}
