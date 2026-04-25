import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashInviteToken, hashPassword, signJwt, verifyPassword } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash || !user.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

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

router.post('/accept-invite', async (req, res, next) => {
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

export default router;
