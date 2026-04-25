import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateInviteToken } from '../lib/auth.js';
import { sendInviteEmail } from '../lib/mailer.js';
import { env } from '../env.js';

const router = Router();

router.use(requireAuth, requireRole(Role.ADMIN));

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role),
});

router.post('/invitations', async (req, res, next) => {
  try {
    const { email, role } = inviteSchema.parse(req.body);
    const normalized = email.toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email: normalized } });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.invitation.create({
      data: {
        email: normalized,
        role,
        tokenHash,
        expiresAt,
        invitedById: req.user!.sub,
      },
    });

    const inviteUrl = `${env.appUrl}/accept-invite?token=${token}`;
    await sendInviteEmail(normalized, inviteUrl, role);

    res.status(201).json({
      invitation: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
      // Returned in dev so admin can copy/paste the link if SMTP isn't set.
      inviteUrl: env.smtp.host ? undefined : inviteUrl,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/invitations', async (_req, res, next) => {
  try {
    const invites = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ invitations: invites });
  } catch (err) {
    next(err);
  }
});

const listUsersQuery = z.object({
  // Comma-separated roles, e.g. ?roles=EMPLOYEE,SUBCONTRACTOR
  roles: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
});

router.get('/users', async (req, res, next) => {
  try {
    const { roles, active } = listUsersQuery.parse(req.query);
    const where: { role?: { in: Role[] }; isActive?: boolean } = {};
    if (roles) {
      const parsed = roles
        .split(',')
        .map((r) => r.trim().toUpperCase())
        .filter((r): r is Role => (Object.values(Role) as string[]).includes(r));
      if (parsed.length) where.role = { in: parsed };
    }
    if (active) where.isActive = active === 'true';

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        isSales: true,
        isProjectManager: true,
        createdAt: true,
      },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.nativeEnum(Role).optional(),
  isSales: z.boolean().optional(),
  isProjectManager: z.boolean().optional(),
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        isSales: true,
        isProjectManager: true,
      },
    });
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
