import { Router } from 'express';
import { z } from 'zod';
import { Role, MembershipTier } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const upsertSchema = z.object({
  tier: z.nativeEnum(MembershipTier),
  renewsAt: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

// Customer reads their own membership.
router.get('/me', async (req, res, next) => {
  try {
    if (req.user!.role !== Role.CUSTOMER) {
      return res.status(404).json({ error: 'Membership only applies to customers' });
    }
    const membership = await prisma.membership.findUnique({
      where: { customerId: req.user!.sub },
    });
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

// Admin lists all memberships (with customer info).
router.get('/', requireRole(Role.ADMIN), async (_req, res, next) => {
  try {
    const memberships = await prisma.membership.findMany({
      orderBy: { startedAt: 'desc' },
      include: { customer: { select: { id: true, name: true, email: true } } },
    });
    res.json({ memberships });
  } catch (err) {
    next(err);
  }
});

// Admin upserts membership for a specific customer.
router.put('/:customerId', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const customer = await prisma.user.findUnique({ where: { id: req.params.customerId } });
    if (!customer || customer.role !== Role.CUSTOMER) {
      return res.status(400).json({ error: 'customerId must reference a customer' });
    }
    const renewsAt =
      data.renewsAt === null ? null : data.renewsAt ? new Date(data.renewsAt) : undefined;

    const membership = await prisma.membership.upsert({
      where: { customerId: customer.id },
      create: {
        customerId: customer.id,
        tier: data.tier,
        renewsAt: renewsAt ?? undefined,
        active: data.active ?? true,
      },
      update: {
        tier: data.tier,
        renewsAt,
        active: data.active,
      },
      include: { customer: { select: { id: true, name: true, email: true } } },
    });
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});

router.delete('/:customerId', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    await prisma.membership.delete({ where: { customerId: req.params.customerId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
