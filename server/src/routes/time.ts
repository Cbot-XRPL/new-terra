import { Router } from 'express';
import { z } from 'zod';
import { Role, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

// ----- Punch in/out -----

const startSchema = z.object({
  projectId: z.string().nullable().optional(),
  notes: z.string().max(1000).optional(),
  hourlyRateCents: z.number().int().nonnegative().optional(),
  billable: z.boolean().optional(),
});

// Returns the user's currently-open entry (one at a time per user). Used by
// the punch-in/out widget to render the right state.
router.get('/active', async (req, res, next) => {
  try {
    const entry = await prisma.timeEntry.findFirst({
      where: { userId: req.user!.sub, endedAt: null },
      include: { project: { select: { id: true, name: true } } },
    });
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.post('/punch-in', async (req, res, next) => {
  try {
    // Only staff (employee/sub/admin) clock time. Customers shouldn't ever
    // see the punch-in widget; this is a defence-in-depth check.
    const role = req.user!.role;
    if (role === Role.CUSTOMER) return res.status(403).json({ error: 'Forbidden' });

    const data = startSchema.parse(req.body ?? {});
    // Auto-close any prior open entry — clocking in twice without out is a
    // common UI mistake; we'd rather close the previous than reject silently.
    const existingOpen = await prisma.timeEntry.findFirst({
      where: { userId: req.user!.sub, endedAt: null },
    });
    if (existingOpen) {
      const minutes = Math.max(
        0,
        Math.round((Date.now() - existingOpen.startedAt.getTime()) / 60_000),
      );
      await prisma.timeEntry.update({
        where: { id: existingOpen.id },
        data: { endedAt: new Date(), minutes },
      });
    }

    const entry = await prisma.timeEntry.create({
      data: {
        userId: req.user!.sub,
        projectId: data.projectId ?? null,
        startedAt: new Date(),
        notes: data.notes,
        billable: data.billable ?? true,
        hourlyRateCents: data.hourlyRateCents ?? 0,
      },
      include: { project: { select: { id: true, name: true } } },
    });
    res.status(201).json({ entry });
  } catch (err) {
    next(err);
  }
});

router.post('/punch-out', async (req, res, next) => {
  try {
    const open = await prisma.timeEntry.findFirst({
      where: { userId: req.user!.sub, endedAt: null },
    });
    if (!open) return res.status(404).json({ error: 'No active time entry' });
    const ended = new Date();
    const minutes = Math.max(0, Math.round((ended.getTime() - open.startedAt.getTime()) / 60_000));
    const updated = await prisma.timeEntry.update({
      where: { id: open.id },
      data: { endedAt: ended, minutes },
      include: { project: { select: { id: true, name: true } } },
    });
    res.json({ entry: updated });
  } catch (err) {
    next(err);
  }
});

// ----- List / edit -----

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  userId: z.string().optional(),
  projectId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  // Show only completed entries (helpful for payroll views).
  closed: z.enum(['true', 'false']).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || me.role === Role.CUSTOMER) return res.status(403).json({ error: 'Forbidden' });
    const q = listQuery.parse(req.query);
    const where: Prisma.TimeEntryWhereInput = {};
    // Non-accounting employees only see their own time.
    if (!hasAccountingAccess(me)) {
      where.userId = me.id;
    } else if (q.userId) {
      where.userId = q.userId;
    }
    if (q.projectId) where.projectId = q.projectId;
    if (q.from || q.to) {
      where.startedAt = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    if (q.closed === 'true') where.endedAt = { not: null };
    if (q.closed === 'false') where.endedAt = null;

    const [entries, total, agg] = await Promise.all([
      prisma.timeEntry.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          user: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      }),
      prisma.timeEntry.count({ where }),
      prisma.timeEntry.aggregate({ where, _sum: { minutes: true } }),
    ]);
    res.json({
      entries,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalMinutes: agg._sum.minutes ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  projectId: z.string().nullable().optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  billable: z.boolean().optional(),
  hourlyRateCents: z.number().int().nonnegative().optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const existing = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Time entry not found' });
    if (existing.userId !== me.id && !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = updateSchema.parse(req.body);
    const startedAt = data.startedAt ? new Date(data.startedAt) : existing.startedAt;
    const endedAt =
      data.endedAt === null ? null : data.endedAt ? new Date(data.endedAt) : existing.endedAt;
    const minutes = endedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000))
      : 0;

    const entry = await prisma.timeEntry.update({
      where: { id: existing.id },
      data: {
        projectId: data.projectId === null ? null : data.projectId,
        startedAt,
        endedAt,
        minutes,
        notes: data.notes === null ? null : data.notes,
        billable: data.billable,
        hourlyRateCents: data.hourlyRateCents,
      },
      include: {
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });
    res.json({ entry });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const existing = await prisma.timeEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Time entry not found' });
    if (existing.userId !== me.id && !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.timeEntry.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ----- Project labor rollup -----

// Payroll-style CSV export — accounting + admin only. Sums minutes per
// user × project for the supplied date range so it imports cleanly into
// QuickBooks Bills, ADP, or just a spreadsheet for manual review.
const csvQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

router.get('/payroll.csv', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const { from, to } = csvQuery.parse(req.query);
    const start = new Date(from);
    const end = new Date(to);

    const grouped = await prisma.timeEntry.groupBy({
      by: ['userId', 'projectId', 'billable'],
      where: { startedAt: { gte: start, lte: end }, endedAt: { not: null } },
      _sum: { minutes: true },
    });

    // Hydrate user + project names so the CSV is human-readable without
    // joining ids by hand.
    const userIds = [...new Set(grouped.map((g) => g.userId))];
    const projectIds = [...new Set(grouped.map((g) => g.projectId).filter((id): id is string => !!id))];
    const [users, projects] = await Promise.all([
      userIds.length
        ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([]),
      projectIds.length
        ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const projectById = new Map(projects.map((p) => [p.id, p.name]));

    function csvEscape(v: string | number): string {
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    }

    const header = ['user_id', 'user_name', 'user_email', 'project_id', 'project_name', 'billable', 'minutes', 'hours_decimal'];
    const rows = grouped.map((g) => {
      const user = userById.get(g.userId);
      const minutes = g._sum.minutes ?? 0;
      return [
        g.userId,
        user?.name ?? '',
        user?.email ?? '',
        g.projectId ?? '',
        g.projectId ? projectById.get(g.projectId) ?? '' : '(general/overhead)',
        g.billable ? 'true' : 'false',
        minutes,
        (minutes / 60).toFixed(2),
      ];
    });

    const body = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="payroll-${start.toISOString().slice(0, 10)}-to-${end.toISOString().slice(0, 10)}.csv"`,
    );
    res.send(body);
  } catch (err) {
    next(err);
  }
});

router.get('/project/:projectId/summary', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || me.role === Role.CUSTOMER) return res.status(403).json({ error: 'Forbidden' });

    const grouped = await prisma.timeEntry.groupBy({
      by: ['userId', 'billable'],
      where: { projectId: req.params.projectId, endedAt: { not: null } },
      _sum: { minutes: true },
    });
    const userIds = [...new Set(grouped.map((g) => g.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const totalMinutes = grouped.reduce((s, g) => s + (g._sum.minutes ?? 0), 0);
    const billableMinutes = grouped
      .filter((g) => g.billable)
      .reduce((s, g) => s + (g._sum.minutes ?? 0), 0);

    res.json({
      totalMinutes,
      billableMinutes,
      perUser: grouped.map((g) => ({
        userId: g.userId,
        name: userName.get(g.userId) ?? 'Unknown',
        billable: g.billable,
        minutes: g._sum.minutes ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
