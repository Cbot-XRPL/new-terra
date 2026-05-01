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

// Customer lookup — admin, sales, and PM-flagged employees use this when
// picking a customer (drafting a contract, creating a project). Returns
// active customers only.
router.get('/customers', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const allowed =
      me?.role === Role.ADMIN ||
      (me?.role === Role.EMPLOYEE && (me.isSales || me.isProjectManager));
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

// Cross-user profile lookup — backs the universal user-profile page
// (/portal/users/:id). Anyone authenticated can read a basic profile of
// any other user (name, role, avatar, email, phone, tradeType for subs).
// Customers are slightly restricted: they can read staff/contractor
// profiles tied to a project they're on, but not other customers.
// Admins see everything (use the admin user-detail endpoint for the
// full record including rates / W-9 status / licenses).
router.get('/users/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        avatarUrl: true,
        avatarThumbnailUrl: true,
        tradeType: true,
        isActive: true,
        isSales: true,
        isProjectManager: true,
        isAccounting: true,
      },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Customers don't get to see other customers — keeps the customer
    // experience scoped to "you + the company". They CAN see the
    // company's staff / contractors so they know who's working on
    // their project.
    if (me.role === Role.CUSTOMER && target.role === Role.CUSTOMER && me.id !== target.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ user: target });
  } catch (err) {
    next(err);
  }
});

// Contractor lookup — used by estimate line attribution + project pay
// rollups. Returns active SUBCONTRACTOR users with their trade type so
// the sales rep can pre-fill the line label. Admin / sales / PM all read.
router.get('/staff/contractors', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const allowed =
      me?.role === Role.ADMIN ||
      (me?.role === Role.EMPLOYEE && (me.isSales || me.isProjectManager));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    const users = await prisma.user.findMany({
      where: { role: Role.SUBCONTRACTOR, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, tradeType: true },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Project-manager lookup — used by the project create form. Returns the
// EMPLOYEE users flagged as PM. Admins, sales, and PMs can read this list
// (any of those workflows can spin up a project). PM *reassignment* on an
// existing project is still gated to admin in the projects PATCH route.
router.get('/staff/pms', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const allowed =
      me?.role === Role.ADMIN ||
      (me?.role === Role.EMPLOYEE && (me.isSales || me.isProjectManager));
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
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
