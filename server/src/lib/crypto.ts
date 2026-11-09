import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// argon2id with OWASP-recommended baseline parameters.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = async (hashStr: string, pw: string) => {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false;
  }
};
// Used to equalise timing when the user doesn't exist.
let dummyHash: Promise<string> | null = null;
export const dummyVerify = async (pw: string) => {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, pw);
  return false;
};

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
