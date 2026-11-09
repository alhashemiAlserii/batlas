import { z } from 'zod';
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_]+$/, 'letters, numbers and underscore only');
export const passwordSchema = z.string().min(10, 'must be at least 10 characters').max(200);
/** Optional email: '' / missing -> undefined; otherwise must be valid. */
export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || z.string().email().safeParse(v).success, 'must be a valid email (or leave it empty)');
