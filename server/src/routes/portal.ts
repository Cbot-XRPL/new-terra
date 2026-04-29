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
      // Explicit select keeps internal fields (budgetCents) out of the
      // customer payload. Adding new business-only fields to Project should
      // not auto-leak — they have to be added here intentionally.
      prisma.project.findMany({
        where: { customerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          address: true,
          description: true,
          status: true,
          startDate: true,
          endDate: true,
          createdAt: true,
        },
      }),
      prisma.invoice.findMany({ where: { customerId: userId }, orderBy: { issuedAt: 'desc' } }),
      prisma.selection.findMany({ where: { customerId: userId }, orderBy: { createdAt: 'desc' } }),
      prisma.membership.findUnique({ where: { customerId: userId } }),
    ]);
    res.json({ projects, invoices, selections, membership });
  } catch (err) {
    next(err);
  }
});

// Customer lookup — admin and sales-flagged employees use this when picking
// a customer (e.g. drafting a contract). Returns active customers only.
router.get('/customers', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const allowed =
      me?.role === Role.ADMIN || (me?.role === Role.EMPLOYEE && me.isSales);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const users = await prisma.user.findMany({
      where: { role: Role.CUSTOMER, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Project-manager lookup — used by the project create/edit form. Returns the
// EMPLOYEE users flagged as PM. Admin only since reassignment is admin-only.
router.get('/staff/pms', requireRole(Role.ADMIN), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: Role.EMPLOYEE, isProjectManager: true, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Staff lookup — used by project + schedule forms to populate assignee pickers.
router.get(
  '/staff/users',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (_req, res, next) => {
    try {
      const users = await prisma.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR] }, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, role: true },
      });
      res.json({ users });
    } catch (err) {
      next(err);
    }
  },
);

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

// Recent project photos across every active project — drives the photo
// carousel on the staff overview. Returns ~30 most recent images so the
// strip has plenty to scroll through without being heavy.
router.get(
  '/staff/recent-images',
  requireRole(Role.EMPLOYEE, Role.SUBCONTRACTOR, Role.ADMIN),
  async (_req, res, next) => {
    try {
      const images = await prisma.projectImage.findMany({
        where: { project: { archivedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
          mediumUrl: true,
          caption: true,
          phase: true,
          takenAt: true,
          createdAt: true,
          project: { select: { id: true, name: true } },
          uploadedBy: { select: { id: true, name: true } },
        },
      });
      res.json({ images });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
