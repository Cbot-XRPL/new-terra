import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'ValidationError', issues: err.issues });
  }
  if (err instanceof Error) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
  console.error('Unknown error', err);
  res.status(500).json({ error: 'Internal server error' });
}
