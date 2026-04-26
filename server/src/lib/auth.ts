import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../env.js';
import type { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: Role;
  email: string;
  // Version stamp from User.tokenVersion at sign time. The auth middleware
  // re-reads the user on each request and rejects when tokenVersion drifts,
  // which is how we revoke tokens (password reset, role change, sign-out-
  // everywhere) without a session table.
  tv?: number;
}

export function signJwt(payload: JwtPayload): string {
  const options = { expiresIn: env.jwtExpiresIn } as SignOptions;
  return jwt.sign(payload, env.jwtSecret, options);
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Invitation tokens — random 32-byte URL-safe string; we store only the hash.
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
