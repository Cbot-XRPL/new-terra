import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@prisma/client';
import { verifyJwt, type JwtPayload } from '../lib/auth.js';
import { prisma } from '../db.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Bearer header is the primary path. EventSource can't carry custom
  // headers, so we also accept `?token=` for SSE endpoints. The query token
  // is the same JWT, so this widens the surface but doesn't lower the bar.
  let token: string | null = null;
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token.length > 0) {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  let payload: JwtPayload;
  try {
    payload = verifyJwt(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Verify the token version still matches the user record. Tokens minted
  // before a password reset / sign-out-everywhere / disable have a stale
  // `tv` and get rejected here. We also block disabled accounts.
  void (async () => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true, tokenVersion: true },
      });
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Account disabled' });
      }
      if (typeof payload.tv === 'number' && payload.tv !== user.tokenVersion) {
        return res.status(401).json({ error: 'Token revoked — please sign in again' });
      }
      req.user = payload;
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
