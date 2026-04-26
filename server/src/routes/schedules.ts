import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const calendarQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  mine: z.enum(['true', 'false']).optional(),
});

// Company-wide calendar view for staff. Customers must keep using the
// per-project schedule list — they shouldn't see other customers' projects.
router.get('/', requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR), async (req, res, next) => {
  try {
    const { from, to, mine } = calendarQuery.parse(req.query);
    const where: {
      startsAt: { gte: Date; lte: Date };
      assigneeId?: string;
    } = {
      startsAt: { gte: new Date(from), lte: new Date(to) },
    };
    // Subs are always scoped to their own schedules — they should never see
    // the company-wide calendar. The mine=true flag is honored for staff who
    // want to filter by themselves.
    if (req.user!.role === Role.SUBCONTRACTOR || mine === 'true') {
      where.assigneeId = req.user!.sub;
    }

    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: {
        project: { select: { id: true, name: true, address: true } },
        assignee: { select: { id: true, name: true, role: true } },
      },
    });
    res.json({ schedules });
  } catch (err) {
    next(err);
  }
});

const updateScheduleSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  assigneeId: z.string().nullable().optional(),
});

function staffOnly(role: Role) {
  return role === Role.ADMIN || role === Role.EMPLOYEE || role === Role.SUBCONTRACTOR;
}

// Single schedule lookup — customers can only see schedules tied to their project.
router.get('/:id', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const schedule = await prisma.schedule.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, name: true, customerId: true, address: true } },
        assignee: { select: { id: true, name: true, role: true } },
      },
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    if (role === Role.CUSTOMER && schedule.project.customerId !== sub) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole(Role.ADMIN, Role.EMPLOYEE), async (req, res, next) => {
  try {
    const data = updateScheduleSchema.parse(req.body);

    if (data.assigneeId) {
      const assignee = await prisma.user.findUnique({ where: { id: data.assigneeId } });
      if (!assignee || !staffOnly(assignee.role)) {
        return res.status(400).json({ error: 'assigneeId must reference a staff user' });
      }
    }

    const schedule = await prisma.schedule.update({
      where: { id: req.params.id },
      data: {
        title: data.title,
        notes: data.notes ?? undefined,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
        assigneeId: data.assigneeId,
      },
      include: { assignee: { select: { id: true, name: true, role: true } } },
    });
    res.json({ schedule });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(Role.ADMIN, Role.EMPLOYEE), async (req, res, next) => {
  try {
    await prisma.schedule.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
