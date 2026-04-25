import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'ValidationError', issues: err.issues });
  }
  // multer's own errors (file too large, unexpected field, etc.).
  if (err instanceof MulterError) {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  if (err instanceof Error) {
    // Custom upload-rejections from our fileFilter are surfaced as plain
    // Errors; treat them as client errors rather than 500s.
    if (/^Only [\w\- ]+ uploads are allowed$/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
  console.error('Unknown error', err);
  res.status(500).json({ error: 'Internal server error' });
}
