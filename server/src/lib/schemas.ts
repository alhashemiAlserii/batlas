import { z } from 'zod';

/** Unique sign-in name. Stored with its original casing; compared case-insensitively. */
export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_]+$/, 'letters, numbers and underscore only');

/** @deprecated Alias of {@link handleSchema}. Older clients send `username`. */
export const usernameSchema = handleSchema;

/** 4–6 digit numeric PIN. Hashed before it is stored; never logged. */
export const pinSchema = z.string().regex(/^\d{4,6}$/, 'must be 4 to 6 digits');

/**
 * Name other people see. Not unique. Letters and numbers, with spaces and a little punctuation.
 * One character is allowed ("A"); the first and last character must be a letter or number.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(24, 'must be at most 24 characters')
  .regex(/^[\p{L}\p{N}](?:[\p{L}\p{N} ._'’-]*[\p{L}\p{N}])?$/u, 'use letters, numbers, spaces, and . _ \' -');

/** Legacy account passwords (only used once, to set a PIN). Not accepted at sign-in. */
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

const emptyToUndef = (v: unknown) => (typeof v === 'string' && !v.trim() ? undefined : v);
export const optionalDisplayName = z.preprocess(emptyToUndef, displayNameSchema.optional());
