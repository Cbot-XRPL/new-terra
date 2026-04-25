// Portal endpoints — minimal placeholder responses so each role's dashboard
// has real data shapes to render against. Fill these in incrementally.

import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// --- Customer ---
router.get('/customer/overview', requireRole(Role.CUSTOMER), async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    const [projects, invoices, selections, membership] = await Promise.all([
      prisma.project.findMany({ where: { customerId: userId }, orderBy: { createdAt: 'desc' } }),
      prisma.invoice.findMany({ where: { customerId: userId }, orderBy: { issuedAt: 'desc' } }),
      prisma.selection.findMany({ where: { customerId: userId }, orderBy: { createdAt: 'desc' } }),
      prisma.membership.findUnique({ where: { customerId: userId } }),
    ]);
    res.json({ projects, invoices, selections, membership });
  } catch (err) {
    next(err);
  }
});

// --- Employee / Subcontractor ---
router.get(
  '/staff/overview',
  requireRole(Role.EMPLOYEE, Role.SUBCONTRACTOR, Role.ADMIN),
  async (req, res, next) => {
    try {
      const userId = req.user!.sub;
      const now = new Date();
      const [schedules, board] = await Promise.all([
        prisma.schedule.findMany({
          where: { OR: [{ assigneeId: userId }, { assigneeId: null }], endsAt: { gte: now } },
          orderBy: { startsAt: 'asc' },
          take: 25,
          include: { project: { select: { name: true, address: true } } },
        }),
        prisma.messageBoardPost.findMany({
          orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
          take: 25,
          include: { author: { select: { name: true, role: true } } },
        }),
      ]);
      res.json({ schedules, board });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
