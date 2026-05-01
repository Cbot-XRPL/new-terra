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

// Dashboard alerts — surfaces a small list of "things that need your
// attention" right under the greeting on the home page. Role-aware so
// the customer doesn't see internal compliance items, and so each
// staff role only sees what they can act on. Each alert has:
//   level: 'info' | 'warning' | 'urgent'
//   message: short one-liner
//   href: optional in-app link
// The UI renders them as a list with a colour cue per level.
router.get('/alerts', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    // dismissable=true: soft alerts that auto-clear when the user
    //   taps "open" or hits Clear (DMs, board posts, stale leads,
    //   pending queues — they're "fyi" items, not blockers).
    // dismissable=false: hard alerts that stay until the underlying
    //   data changes (driver's licence missing, W-9 not on file,
    //   customer-side overdue invoices, etc.). Tapping these dismisses
    //   nothing; the only way to clear them is to fix the situation.
    type Alert = {
      level: 'info' | 'warning' | 'urgent';
      message: string;
      href?: string;
      dismissable: boolean;
    };
    const alerts: Alert[] = [];

    // Universal alerts — apply to every role.
    // Anything created after this watermark counts as a "new" alert
    // for the dashboard. Tapping Clear advances it to now.
    const since = me.alertsLastClearedAt ?? new Date(0);
    const [unread, newBoardPosts] = await Promise.all([
      prisma.message.count({
        where: { toUserId: me.id, readAt: null, createdAt: { gt: since } },
      }),
      // Board posts include both DM-channel + company-wide messages —
      // we want any post the user hasn't already cleared past.
      me.role === Role.CUSTOMER
        ? Promise.resolve(0)
        : prisma.messageBoardPost.count({ where: { createdAt: { gt: since } } }),
    ]);
    if (unread > 0) {
      alerts.push({
        level: 'info',
        message: `${unread} unread DM${unread === 1 ? '' : 's'}`,
        href: '/portal/messages',
        dismissable: true,
      });
    }
    if (newBoardPosts > 0) {
      alerts.push({
        level: 'info',
        message: `${newBoardPosts} new company post${newBoardPosts === 1 ? '' : 's'} on the message board`,
        href: '/portal/board',
        dismissable: true,
      });
    }
    if (!me.driversLicenseUrl) {
      alerts.push({
        level: 'urgent',
        message: 'Driver\'s licence missing — please upload one.',
        href: '/portal/profile#documents',
        dismissable: false,
      });
    }

    // W-9 compliance — everyone in the company (admin, employee,
    // subcontractor) needs one on file. Customers don't file W-9s
    // with us, so they're excluded.
    if (me.role !== Role.CUSTOMER && !me.w9SignedAt) {
      alerts.push({
        level: 'warning',
        message: 'W-9 not on file — submit before your next pay request.',
        href: '/portal/time',
        dismissable: false,
      });
    }

    // Admin / accounting — approval queues.
    const isAccountingPath =
      me.role === Role.ADMIN || (me.role === Role.EMPLOYEE && me.isAccounting);
    if (isAccountingPath) {
      const [pendingPay, pendingBills] = await Promise.all([
        // Pending pay request entries — neither approved nor rejected,
        // and the entry is "closed" (endedAt set, so it's a recorded
        // shift the worker is asking to be paid for).
        prisma.timeEntry.count({
          where: { approvedAt: null, rejectedAt: null, endedAt: { not: null } },
        }),
        prisma.subcontractorBill.count({ where: { status: 'PENDING' } }),
      ]);
      if (pendingPay > 0) {
        alerts.push({
          level: 'warning',
          message: `${pendingPay} pay request${pendingPay === 1 ? '' : 's'} awaiting approval`,
          href: '/portal/time',
          dismissable: true,
        });
      }
      if (pendingBills > 0) {
        alerts.push({
          level: 'warning',
          message: `${pendingBills} sub bill${pendingBills === 1 ? '' : 's'} awaiting review`,
          href: '/portal/subcontractor-bills',
          dismissable: true,
        });
      }
    }

    // Sales — stale leads + invitations not yet accepted.
    if (me.role === Role.ADMIN || (me.role === Role.EMPLOYEE && me.isSales)) {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const staleLeads = await prisma.lead.count({
        where: {
          status: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT'] },
          updatedAt: { lt: fourteenDaysAgo },
        },
      });
      if (staleLeads > 0) {
        alerts.push({
          level: 'info',
          message: `${staleLeads} lead${staleLeads === 1 ? '' : 's'} idle 14+ days`,
          href: '/portal/leads',
          dismissable: true,
        });
      }
    }

    // Customer-side nudges — pending estimates / unpaid invoices.
    // These stay until resolved (paid / reviewed) — no dismiss.
    if (me.role === Role.CUSTOMER) {
      const [pendingEstimates, openInvoices] = await Promise.all([
        prisma.estimate.count({
          where: { customerId: me.id, status: { in: ['SENT', 'VIEWED'] } },
        }),
        prisma.invoice.count({
          where: { customerId: me.id, status: { in: ['SENT', 'OVERDUE'] } },
        }),
      ]);
      if (pendingEstimates > 0) {
        alerts.push({
          level: 'info',
          message: `${pendingEstimates} estimate${pendingEstimates === 1 ? '' : 's'} waiting on your review`,
          href: '/portal/estimates',
          dismissable: false,
        });
      }
      if (openInvoices > 0) {
        alerts.push({
          level: 'warning',
          message: `${openInvoices} invoice${openInvoices === 1 ? '' : 's'} due`,
          href: '/portal/invoices',
          dismissable: false,
        });
      }
    }

    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// Clear the dashboard alerts panel — advances the user's
// alertsLastClearedAt to "now" so DMs + board posts older than this
// no longer surface as alerts. Doesn't mark anything read or change
// the underlying records.
router.post('/alerts/clear', async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { alertsLastClearedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Cross-project gallery — every project image visible to the caller in
// one feed. Customers see only their own projects' photos; staff see
// every project. Paginated by createdAt desc with a sane upper bound
// so a thousand-photo company doesn't pull the whole table at once.
router.get('/gallery', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 60));
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

    // Customer scope — only photos on their own projects.
    const projectFilter = me.role === Role.CUSTOMER
      ? { customerId: me.id }
      : undefined;

    const where = {
      ...(projectId ? { projectId } : {}),
      ...(projectFilter ? { project: projectFilter } : {}),
    };

    const [images, total] = await Promise.all([
      prisma.projectImage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: {
          project: { select: { id: true, name: true, address: true } },
          uploadedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.projectImage.count({ where }),
    ]);

    // Lightweight project list for the filter dropdown — only the
    // projects the caller can actually see photos on.
    const projects = await prisma.project.findMany({
      where: projectFilter,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, name: true, _count: { select: { images: true } } },
    });

    res.json({ images, total, page, pageSize, projects });
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
        // Return capability flags + trade so the assignee picker can label
        // each option with the user's actual role (PM, Sales, Plumber)
        // instead of the generic "(employee)" / "(admin)" text.
        select: {
          id: true,
          name: true,
          role: true,
          isSales: true,
          isProjectManager: true,
          isAccounting: true,
          tradeType: true,
        },
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
