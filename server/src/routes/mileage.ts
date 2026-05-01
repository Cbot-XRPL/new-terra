import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess } from '../lib/permissions.js';
import { getCompanySettings } from '../lib/companySettings.js';

const router = Router();
router.use(requireAuth);

// Mileage is per-user — each driver logs their own trips, accounting + admin
// see everyone's. Customers and subs never see this surface (it's company
// COGS / overhead).
async function loadActor(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

const createSchema = z.object({
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  // Miles entered as a regular decimal; we round to one decimal place
  // internally for storage.
  miles: z.number().positive().max(2000),
  projectId: z.string().nullable().optional(),
  purpose: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  // Optional rate override (cents per mile). Defaults to the company
  // setting at log time so old entries stay locked at the rate that was
  // current then.
  rateCentsPerMile: z.number().int().min(0).max(2000).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (me.role === Role.CUSTOMER || me.role === Role.SUBCONTRACTOR) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const isAccounting = hasAccountingAccess(me);
    const where: { userId?: string; date?: { gte?: Date; lte?: Date } } = {};
    // Plain employees only see their own. Accounting/admin can pass
    // ?userId=… to filter, otherwise see everything.
    const userId = req.query.userId as string | undefined;
    if (!isAccounting) {
      where.userId = me.id;
    } else if (userId) {
      where.userId = userId;
    }
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const entries = await prisma.mileageEntry.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      take: 500,
    });
    const totalMilesTenths = entries.reduce((s, e) => s + e.milesTenths, 0);
    const totalCents = entries.reduce((s, e) => s + e.totalCents, 0);
    res.json({
      entries,
      totals: {
        milesTenths: totalMilesTenths,
        miles: totalMilesTenths / 10,
        deductibleCents: totalCents,
        count: entries.length,
      },
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (me.role === Role.CUSTOMER || me.role === Role.SUBCONTRACTOR) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = createSchema.parse(req.body);
    const settings = await getCompanySettings();
    // Only accounting + admin can override the company-wide deductible
    // rate per entry. Letting plain employees set their own rate would
    // let a worker inflate their own claimed deduction by passing in a
    // higher rateCentsPerMile.
    const overrideAllowed = me.role === Role.ADMIN || hasAccountingAccess(me);
    const rate = overrideAllowed && data.rateCentsPerMile != null
      ? data.rateCentsPerMile
      : settings.mileageRateCents;
    const milesTenths = Math.round(data.miles * 10);
    // total = miles * rate. miles is in tenths (×10); rate is in cents.
    // total cents = (milesTenths * rate) / 10.
    const totalCents = Math.round((milesTenths * rate) / 10);

    if (data.projectId) {
      const project = await prisma.project.findUnique({ where: { id: data.projectId } });
      if (!project) return res.status(400).json({ error: 'projectId not found' });
    }

    const entry = await prisma.mileageEntry.create({
      data: {
        userId: me.id,
        projectId: data.projectId ?? null,
        date: new Date(data.date),
        milesTenths,
        rateCentsPerMile: rate,
        totalCents,
        purpose: data.purpose ?? null,
        notes: data.notes ?? null,
      },
    });
    res.status(201).json({ entry });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const existing = await prisma.mileageEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    if (existing.userId !== me.id && !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.mileageEntry.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// Per-project rollup for the year-end docs. Skips entries without a project
// (overhead) so the project rollup is clean — admin can pull the aggregate
// total via /api/mileage with no project filter for the overhead bucket.
router.get('/by-project', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const schema = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });
    const q = schema.parse(req.query);
    const where: { date?: { gte?: Date; lte?: Date } } = {};
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    const grouped = await prisma.mileageEntry.groupBy({
      by: ['projectId'],
      where,
      _sum: { milesTenths: true, totalCents: true },
      _count: { _all: true },
    });
    const projectIds = grouped.map((g) => g.projectId).filter((x): x is string => !!x);
    const projects = projectIds.length
      ? await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
      : [];
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const rows = grouped.map((g) => ({
      projectId: g.projectId,
      name: g.projectId ? projectName.get(g.projectId) ?? 'Unknown' : 'Overhead / unassigned',
      miles: (g._sum.milesTenths ?? 0) / 10,
      milesTenths: g._sum.milesTenths ?? 0,
      deductibleCents: g._sum.totalCents ?? 0,
      tripCount: g._count._all,
    })).sort((a, b) => b.deductibleCents - a.deductibleCents);
    res.json({ rows });
  } catch (err) { next(err); }
});

export default router;
