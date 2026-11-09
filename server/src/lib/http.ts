import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg, 'validation_error');
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input', code: 'validation_error' });
  const anyErr = err as { type?: string; status?: number; code?: string; message?: string };
  if (anyErr?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (anyErr?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  if (anyErr?.status && anyErr.status < 500) return res.status(anyErr.status).json({ error: anyErr.message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
