import { z } from 'zod';
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z0-9_]+$/, 'letters, numbers and underscore only');
export const passwordSchema = z.string().min(10, 'must be at least 10 characters').max(200);
