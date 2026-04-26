import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  generateInviteToken,
  hashInviteToken,
  hashPassword,
  signJwt,
  verifyPassword,
} from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { env } from '../env.js';

const router = Router();

// Throttle login attempts to slow down credential-stuffing. 10 attempts per
// IP per 15 minutes is generous for humans but breaks tool-driven brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Accept-invite gets the same treatment — somebody scraping invite tokens
// shouldn't get unlimited tries.
const acceptInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Reset request is the most-spammable endpoint (anyone can poke it). Tight
// per-IP limit; the per-account abuse case is already mitigated because
// generating a fresh token invalidates older un-used ones.
const resetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again later.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash || !user.isActive) {
      // Audit failed login (only when an account exists) so abuse trails are
      // visible without leaking which emails are valid.
      if (user) {
        audit(req, {
          action: 'auth.login_failed',
          resourceType: 'user',
          resourceId: user.id,
          meta: { reason: !user.passwordHash ? 'no_password' : 'inactive' },
        }).catch(() => undefined);
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      audit(req, {
        action: 'auth.login_failed',
        resourceType: 'user',
        resourceId: user.id,
        meta: { reason: 'bad_password' },
      }).catch(() => undefined);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signJwt({ sub: user.id, role: user.role, email: user.email });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSales: user.isSales,
        isProjectManager: user.isProjectManager,
        isAccounting: user.isAccounting,
        avatarUrl: user.avatarUrl,
        avatarThumbnailUrl: user.avatarThumbnailUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        isSales: true,
        isProjectManager: true,
        isAccounting: true,
        avatarUrl: true,
        avatarThumbnailUrl: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

const acceptSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(1),
  password: z.string().min(8),
  phone: z.string().optional(),
});

router.post('/accept-invite', acceptInviteLimiter, async (req, res, next) => {
  try {
    const { token, name, password, phone } = acceptSchema.parse(req.body);
    const tokenHash = hashInviteToken(token);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation is invalid or expired' });
    }

    const existing = await prisma.user.findUnique({ where: { email: invite.email.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: invite.email.toLowerCase(),
          name,
          phone,
          role: invite.role,
          passwordHash,
        },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      return created;
    });

    const jwtToken = signJwt({ sub: user.id, role: user.role, email: user.email });
    res.json({
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSales: user.isSales,
        isProjectManager: user.isProjectManager,
        isAccounting: user.isAccounting,
        avatarUrl: user.avatarUrl,
        avatarThumbnailUrl: user.avatarThumbnailUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Public endpoint to check whether an invite token is still valid (used by the
// accept-invite page to show the email + role before the user sets a password).
router.get('/invite/:token', async (req, res, next) => {
  try {
    const tokenHash = hashInviteToken(req.params.token);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return res.status(404).json({ error: 'Invitation is invalid or expired' });
    }
    res.json({ email: invite.email, role: invite.role });
  } catch (err) {
    next(err);
  }
});

// ---- Password reset ----

const RESET_TTL_MIN = 60;

const requestResetSchema = z.object({ email: z.string().email() });

// Always returns 200 to avoid leaking which emails are registered. Real
// users get an email; bogus addresses get nothing.
router.post('/request-password-reset', resetRequestLimiter, async (req, res, next) => {
  try {
    const { email } = requestResetSchema.parse(req.body);
    const normalized = email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (user && user.isActive) {
      // Invalidate any prior un-used tokens — only the latest works.
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      });
      const { token, tokenHash } = generateInviteToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60 * 1000),
        },
      });
      const resetUrl = `${env.appUrl}/reset-password?token=${token}`;
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        ttlMinutes: RESET_TTL_MIN,
      }).catch((err) => console.warn('[auth] reset email failed', err));
      audit(req, {
        action: 'auth.password_reset_requested',
        resourceType: 'user',
        resourceId: user.id,
      }).catch(() => undefined);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

router.post('/reset-password', acceptInviteLimiter, async (req, res, next) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const tokenHash = hashInviteToken(token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }
    if (!record.user.isActive) {
      return res.status(400).json({ error: 'Account is no longer active' });
    }
    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Burn any other outstanding tokens so a stolen one doesn't get
      // reused after the legitimate reset.
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
    ]);
    audit(req, {
      action: 'auth.password_reset_completed',
      resourceType: 'user',
      resourceId: record.userId,
    }).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Lookup endpoint for the reset page so we can show the user's name before
// they type a new password (mirrors /invite/:token UX).
router.get('/reset-token/:token', async (req, res, next) => {
  try {
    const tokenHash = hashInviteToken(req.params.token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { email: true, name: true, isActive: true } } },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
      return res.status(404).json({ error: 'Reset link is invalid or expired' });
    }
    res.json({ email: record.user.email, name: record.user.name });
  } catch (err) {
    next(err);
  }
});

export default router;
