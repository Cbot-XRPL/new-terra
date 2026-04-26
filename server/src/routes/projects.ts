import { Router } from 'express';
import { z } from 'zod';
import { ProjectStatus, Role, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canManageProject, hasProjectManagerCapability, hasAccountingAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

// ----- Helpers -----

function isStaff(role: Role) {
  return role === Role.ADMIN || role === Role.EMPLOYEE || role === Role.SUBCONTRACTOR;
}

const projectInclude = {
  customer: { select: { id: true, name: true, email: true } },
  projectManager: { select: { id: true, name: true, email: true } },
} as const;

// Strip the budget from any project payload returned to a CUSTOMER unless
// admin has explicitly opted that project in (showBudgetToCustomer). Internal
// callers always see the full record.
function redactForCustomer<T extends { budgetCents?: number | null; showBudgetToCustomer?: boolean }>(
  role: Role,
  project: T,
): T {
  if (role !== Role.CUSTOMER) return project;
  if (project.showBudgetToCustomer) return project;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { budgetCents: _budgetCents, ...rest } = project;
  return rest as T;
}

// Customers see only their own; admins see everything; project-manager
// employees see only the projects they're assigned to; other staff fall back
// to "all" so existing schedule + image flows keep working.
async function loadProjectForUser(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: projectInclude,
  });
  if (!project) return null;
  if (role === Role.CUSTOMER && project.customerId !== userId) return null;
  if (role === Role.SUBCONTRACTOR) {
    // Subs only see projects they have at least one schedule on.
    const ownsSchedule = await prisma.schedule.count({
      where: { projectId, assigneeId: userId },
    });
    if (ownsSchedule === 0) return null;
  }
  return project;
}

// ----- Projects -----

const createProjectSchema = z.object({
  name: z.string().min(1),
  customerId: z.string().min(1),
  address: z.string().optional(),
  description: z.string().optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  projectManagerId: z.string().nullable().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  budgetCents: z.number().int().nonnegative().nullable().optional(),
  showBudgetToCustomer: z.boolean().optional(),
});

const updateProjectSchema = createProjectSchema.partial().omit({ customerId: true });

async function ensureCanWriteProject(userId: string, projectId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!me || !project) return { me, project, allowed: false as const };
  return { me, project, allowed: canManageProject(me, project).write };
}

router.get('/', async (req, res, next) => {
  try {
    const { sub: userId, role } = req.user!;
    const me = await prisma.user.findUnique({ where: { id: userId } });
    let where: Prisma.ProjectWhereInput = {};
    if (role === Role.CUSTOMER) {
      where = { customerId: userId };
    } else if (role === Role.SUBCONTRACTOR) {
      // Subs only see projects they're scheduled on. We use a relation
      // filter so a sub never knows another customer/project exists.
      where = { schedules: { some: { assigneeId: userId } } };
    } else if (
      role === Role.EMPLOYEE &&
      me &&
      hasProjectManagerCapability(me) &&
      !me.isSales
    ) {
      // Pure PM employees default to seeing only the projects they manage.
      // Admins, sales-flagged employees, and subs see the full list.
      where = { projectManagerId: userId };
    }
    // Default to hiding archived projects so the active list isn't drowned;
    // ?archived=true (admin-only) reveals them.
    if (req.query.archived !== 'true') {
      where.archivedAt = null;
    } else if (me?.role !== Role.ADMIN) {
      where.archivedAt = null;
    }
    const projects = await prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        ...projectInclude,
        _count: { select: { schedules: true, invoices: true, images: true, contracts: true } },
      },
    });
    res.json({ projects: projects.map((p) => redactForCustomer(role, p)) });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = createProjectSchema.parse(req.body);
    const customer = await prisma.user.findUnique({ where: { id: data.customerId } });
    if (!customer || customer.role !== Role.CUSTOMER) {
      return res.status(400).json({ error: 'customerId must reference a CUSTOMER user' });
    }
    if (data.projectManagerId) {
      const pm = await prisma.user.findUnique({ where: { id: data.projectManagerId } });
      if (!pm || pm.role !== Role.EMPLOYEE || !pm.isProjectManager) {
        return res
          .status(400)
          .json({ error: 'projectManagerId must reference an EMPLOYEE flagged as PM' });
      }
    }
    const project = await prisma.project.create({
      data: {
        name: data.name,
        customerId: data.customerId,
        address: data.address,
        description: data.description,
        status: data.status,
        projectManagerId: data.projectManagerId ?? null,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        budgetCents: data.budgetCents ?? null,
        showBudgetToCustomer: data.showBudgetToCustomer ?? false,
      },
      include: projectInclude,
    });
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const project = await loadProjectForUser(req.params.id, sub, role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: redactForCustomer(role, project) });
  } catch (err) {
    next(err);
  }
});

// PATCH is open to admin + assigned PM (write access via canManageProject).
// Customers (and unassigned PMs) get 403.
router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateProjectSchema.parse(req.body);
    const { allowed, me } = await ensureCanWriteProject(req.user!.sub, req.params.id);
    if (!allowed || !me) return res.status(403).json({ error: 'Forbidden' });

    // Only admin can reassign the PM (otherwise a PM could orphan their own
    // project) and only admin can change the customer.
    if (data.projectManagerId !== undefined && me.role !== Role.ADMIN) {
      return res.status(403).json({ error: 'Only admins can reassign the PM' });
    }
    if (data.projectManagerId) {
      const pm = await prisma.user.findUnique({ where: { id: data.projectManagerId } });
      if (!pm || pm.role !== Role.EMPLOYEE || !pm.isProjectManager) {
        return res
          .status(400)
          .json({ error: 'projectManagerId must reference an EMPLOYEE flagged as PM' });
      }
    }

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...data,
        projectManagerId:
          data.projectManagerId === null
            ? null
            : data.projectManagerId === undefined
              ? undefined
              : data.projectManagerId,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        budgetCents: data.budgetCents === null ? null : data.budgetCents,
        showBudgetToCustomer: data.showBudgetToCustomer,
      },
      include: projectInclude,
    });
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Soft archive — admin only. Project keeps all data; just falls out of the
// default project list. Pair with /unarchive.
router.post('/:id/archive', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { archivedAt: new Date() },
      include: projectInclude,
    });
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/unarchive', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { archivedAt: null },
      include: projectInclude,
    });
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

// ----- Schedules nested under a project -----

const createScheduleSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  assigneeId: z.string().optional(),
});

router.get('/:id/schedules', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const project = await loadProjectForUser(req.params.id, sub, role);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const schedules = await prisma.schedule.findMany({
      where: { projectId: project.id },
      orderBy: { startsAt: 'asc' },
      include: { assignee: { select: { id: true, name: true, role: true } } },
    });
    res.json({ schedules });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/schedules', async (req, res, next) => {
  try {
    const data = createScheduleSchema.parse(req.body);
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    // Admin + the assigned PM can always schedule on their projects. Sales-
    // flagged employees can schedule on any project to help the PM coordinate.
    // Pure-PM employees who aren't assigned to *this* project cannot — that
    // prevents one PM from scheduling work on another PM's job.
    const canSchedule =
      me.role === Role.ADMIN ||
      (me.role === Role.EMPLOYEE &&
        (project.projectManagerId === me.id || !me.isProjectManager || me.isSales));
    if (!canSchedule) return res.status(403).json({ error: 'Forbidden' });

    if (data.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: data.assigneeId } });
      if (!assignee || !isStaff(assignee.role)) {
        return res.status(400).json({ error: 'assigneeId must reference a staff user' });
      }
    }

    const schedule = await prisma.schedule.create({
      data: {
        projectId: project.id,
        title: data.title,
        notes: data.notes,
        startsAt: new Date(data.startsAt),
        endsAt: new Date(data.endsAt),
        assigneeId: data.assigneeId,
      },
      include: { assignee: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ schedule });
  } catch (err) {
    next(err);
  }
});

// ----- Job costing -----
//
// Combines per-category budget lines with rolled-up actual expenses to give
// PMs and accounting a single source of truth for "are we on budget on this
// job?". Visible to the project's customer + assigned PM + admin + accounting.

const budgetLineSchema = z.object({
  categoryId: z.string().nullable().optional(),
  budgetCents: z.number().int().nonnegative(),
  notes: z.string().max(500).nullable().optional(),
});

router.get('/:id/job-cost', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { budgetLines: { include: { category: { select: { id: true, name: true } } } } },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    // Customers only see job-cost data when admin has explicitly opted the
    // project in (open-book / cost-plus). Otherwise margin info stays internal.
    if (me.role === Role.CUSTOMER) {
      if (project.customerId !== me.id || !project.showBudgetToCustomer) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else {
      const access = canManageProject(me, project).read || hasAccountingAccess(me);
      if (!access) return res.status(403).json({ error: 'Forbidden' });
    }

    // Roll up actual spend per category for this project. We tolerate
    // categoryId being null (uncategorised expenses bucket together).
    const grouped = await prisma.expense.groupBy({
      by: ['categoryId'],
      where: { projectId: project.id },
      _sum: { amountCents: true },
      _count: { _all: true },
    });

    type Row = {
      categoryId: string | null;
      categoryName: string | null;
      budgetCents: number;
      actualCents: number;
      expenseCount: number;
    };
    const rows = new Map<string, Row>();
    const keyOf = (id: string | null) => id ?? '__uncategorised__';

    for (const line of project.budgetLines) {
      const key = keyOf(line.categoryId);
      rows.set(key, {
        categoryId: line.categoryId,
        categoryName: line.category?.name ?? null,
        budgetCents: line.budgetCents,
        actualCents: 0,
        expenseCount: 0,
      });
    }

    // Need names for any actual-only categories that don't have a budget line.
    const orphanCatIds = grouped
      .map((g) => g.categoryId)
      .filter((id): id is string => !!id && !rows.has(keyOf(id)));
    const orphanCats = orphanCatIds.length
      ? await prisma.expenseCategory.findMany({
          where: { id: { in: orphanCatIds } },
          select: { id: true, name: true },
        })
      : [];
    const orphanName = new Map(orphanCats.map((c) => [c.id, c.name]));

    for (const g of grouped) {
      const key = keyOf(g.categoryId);
      const existing = rows.get(key);
      if (existing) {
        existing.actualCents = g._sum.amountCents ?? 0;
        existing.expenseCount = g._count._all;
      } else {
        rows.set(key, {
          categoryId: g.categoryId,
          categoryName: g.categoryId ? orphanName.get(g.categoryId) ?? 'Unknown' : null,
          budgetCents: 0,
          actualCents: g._sum.amountCents ?? 0,
          expenseCount: g._count._all,
        });
      }
    }

    const lines = [...rows.values()].sort((a, b) => {
      const an = a.categoryName ?? 'Uncategorised';
      const bn = b.categoryName ?? 'Uncategorised';
      return an.localeCompare(bn);
    });

    // Labor cost rollup: sum (minutes × hourlyRateCents) across every closed
    // time entry on this project. Open punch-ins are skipped — they could
    // bloat the total mid-day before they're closed. Emitted as a synthetic
    // "labor" row so it shows alongside the expense categories.
    const closedEntries = await prisma.timeEntry.findMany({
      where: { projectId: project.id, endedAt: { not: null } },
      select: { minutes: true, hourlyRateCents: true },
    });
    const laborCents = closedEntries.reduce(
      (sum, e) => sum + Math.round((e.minutes / 60) * e.hourlyRateCents),
      0,
    );
    const laborEntryCount = closedEntries.length;

    if (laborCents > 0 || laborEntryCount > 0) {
      lines.push({
        categoryId: '__labor__',
        categoryName: 'Labor (time entries)',
        budgetCents: 0,
        actualCents: laborCents,
        expenseCount: laborEntryCount,
      });
    }

    const linesBudget = lines.reduce((sum, l) => sum + l.budgetCents, 0);
    const actualTotal = lines.reduce((sum, l) => sum + l.actualCents, 0);
    // Top-level project budget overrides if set; otherwise fall back to the
    // sum of the lines so projects without a top number still surface a roll-up.
    const totalBudgetCents = project.budgetCents ?? (linesBudget > 0 ? linesBudget : 0);

    // Revenue side: sum every payment received against an invoice on this
    // project. We use payments (not invoice.amountCents) so the P&L view
    // reflects cash actually in the door, not just billed.
    const projectInvoices = await prisma.invoice.findMany({
      where: { projectId: project.id, status: { not: 'VOID' } },
      include: { payments: { select: { amountCents: true } } },
    });
    const invoicedCents = projectInvoices.reduce((s, inv) => s + inv.amountCents, 0);
    const collectedCents = projectInvoices.reduce(
      (s, inv) => s + inv.payments.reduce((p, x) => p + x.amountCents, 0),
      0,
    );
    const marginCents = collectedCents - actualTotal;
    const marginPct = collectedCents > 0
      ? Math.round((marginCents / collectedCents) * 1000) / 10
      : null;

    res.json({
      projectId: project.id,
      totalBudgetCents,
      linesBudgetCents: linesBudget,
      actualCents: actualTotal,
      laborCents,
      laborEntryCount,
      varianceCents: totalBudgetCents - actualTotal,
      // P&L view — same numbers admin would otherwise calc by hand.
      invoicedCents,
      collectedCents,
      marginCents,
      marginPct,
      lines,
    });
  } catch (err) {
    next(err);
  }
});

// Budget-line CRUD — admin + PM + accounting (per the same project-write
// rule) can add/edit. Customers cannot mutate budgets.
async function ensureBudgetWrite(userId: string, projectId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId } });
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!me || !project) return { ok: false as const };
  const writeViaProject = canManageProject(me, project).write;
  const writeViaAccounting = hasAccountingAccess(me);
  return { ok: writeViaProject || writeViaAccounting, me, project };
}

router.get('/:id/budget-lines', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (me.role === Role.CUSTOMER) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!canManageProject(me, project).read && !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const lines = await prisma.projectBudgetLine.findMany({
      where: { projectId: project.id },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ lines });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/budget-lines', async (req, res, next) => {
  try {
    const data = budgetLineSchema.parse(req.body);
    const guard = await ensureBudgetWrite(req.user!.sub, req.params.id);
    if (!guard.ok) return res.status(403).json({ error: 'Forbidden' });

    // Postgres allows multiple NULLs in a unique index so the compound upsert
    // doesn't work for the "uncategorised" bucket — fall back to find + branch.
    const existing = await prisma.projectBudgetLine.findFirst({
      where: {
        projectId: req.params.id,
        categoryId: data.categoryId ?? null,
      },
    });
    const payload = {
      projectId: req.params.id,
      categoryId: data.categoryId ?? null,
      budgetCents: data.budgetCents,
      notes: data.notes ?? null,
    };
    const line = existing
      ? await prisma.projectBudgetLine.update({
          where: { id: existing.id },
          data: payload,
          include: { category: { select: { id: true, name: true } } },
        })
      : await prisma.projectBudgetLine.create({
          data: payload,
          include: { category: { select: { id: true, name: true } } },
        });
    res.status(existing ? 200 : 201).json({ line });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/budget-lines/:lineId', async (req, res, next) => {
  try {
    const guard = await ensureBudgetWrite(req.user!.sub, req.params.id);
    if (!guard.ok) return res.status(403).json({ error: 'Forbidden' });
    const line = await prisma.projectBudgetLine.findUnique({
      where: { id: req.params.lineId },
    });
    if (!line || line.projectId !== req.params.id) {
      return res.status(404).json({ error: 'Budget line not found' });
    }
    await prisma.projectBudgetLine.delete({ where: { id: line.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
