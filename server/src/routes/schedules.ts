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

// Common include shape — pull both the legacy single assignee (for any
// older rows that haven't been migrated) AND the join-table users so
// the API returns a unified `assignees: User[]` either way.
const scheduleInclude = {
  project: { select: { id: true, name: true, address: true } },
  assignee: {
    select: {
      id: true, name: true, role: true,
      isSales: true, isProjectManager: true, isAccounting: true, tradeType: true,
    },
  },
  assignees: {
    include: {
      user: {
        select: {
          id: true, name: true, role: true,
          isSales: true, isProjectManager: true, isAccounting: true, tradeType: true,
        },
      },
    },
  },
} as const;

// Flatten the assignee + assignees rows into one deduped list before
// sending to the client. Older rows have only the singular FK; newer
// rows write to the join table.
function withFlatAssignees<T extends {
  assignee: { id: string; name: string; role: Role; isSales?: boolean; isProjectManager?: boolean; isAccounting?: boolean; tradeType?: string | null } | null;
  assignees: Array<{ user: { id: string; name: string; role: Role; isSales?: boolean; isProjectManager?: boolean; isAccounting?: boolean; tradeType?: string | null } }>;
}>(s: T) {
  const flat = [
    ...s.assignees.map((a) => a.user),
    ...(s.assignee && !s.assignees.some((a) => a.user.id === s.assignee!.id) ? [s.assignee] : []),
  ];
  return { ...s, assignees: flat };
}

// Company-wide calendar view for staff. Customers must keep using the
// per-project schedule list — they shouldn't see other customers' projects.
router.get('/', requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR, Role.PHOTOGRAPHER), async (req, res, next) => {
  try {
    const { from, to, mine } = calendarQuery.parse(req.query);
    const meId = req.user!.sub;
    // Subs + photographers are always scoped to their own schedules.
    // The mine=true flag on staff/admin lets them filter the same way.
    const meScoped =
      req.user!.role === Role.SUBCONTRACTOR ||
      req.user!.role === Role.PHOTOGRAPHER ||
      mine === 'true';

    const where = meScoped
      ? {
          startsAt: { gte: new Date(from), lte: new Date(to) },
          // "mine" matches either the legacy singular assignee OR a row
          // in the join table.
          OR: [
            { assigneeId: meId },
            { assignees: { some: { userId: meId } } },
          ],
        }
      : {
          startsAt: { gte: new Date(from), lte: new Date(to) },
        };

    const schedules = await prisma.schedule.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: scheduleInclude,
    });
    res.json({ schedules: schedules.map(withFlatAssignees) });
  } catch (err) {
    next(err);
  }
});

const updateScheduleSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  // Legacy single-assignee field — kept for back-compat.
  assigneeId: z.string().nullable().optional(),
  // Multi-assignee — replaces the join-table set entirely on update.
  // Empty array clears all assignments.
  assigneeIds: z.array(z.string()).optional(),
});

function staffOnly(role: Role) {
  // Photographers can be assigned to a schedule (need to know when to
  // show up to shoot) but they don't get the create/edit endpoints.
  return role === Role.ADMIN || role === Role.EMPLOYEE ||
         role === Role.SUBCONTRACTOR || role === Role.PHOTOGRAPHER;
}

// Single schedule lookup — scoped per role:
//  - CUSTOMER: only schedules on their own project
//  - SUBCONTRACTOR / PHOTOGRAPHER: only schedules they're personally
//    assigned to (singular FK or join-table)
//  - ADMIN / EMPLOYEE: any schedule
router.get('/:id', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const schedule = await prisma.schedule.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, name: true, customerId: true, address: true } },
        assignee: {
          select: {
            id: true, name: true, role: true,
            isSales: true, isProjectManager: true, isAccounting: true, tradeType: true,
          },
        },
        assignees: {
          include: {
            user: {
              select: {
                id: true, name: true, role: true,
                isSales: true, isProjectManager: true, isAccounting: true, tradeType: true,
              },
            },
          },
        },
      },
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    if (role === Role.CUSTOMER && schedule.project.customerId !== sub) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    if (role === Role.SUBCONTRACTOR || role === Role.PHOTOGRAPHER) {
      const assignedToMe =
        schedule.assigneeId === sub ||
        schedule.assignees.some((a) => a.user.id === sub);
      if (!assignedToMe) return res.status(404).json({ error: 'Schedule not found' });
    }
    res.json({ schedule: withFlatAssignees(schedule) });
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
    if (data.assigneeIds) {
      const users = await prisma.user.findMany({
        where: { id: { in: data.assigneeIds } },
        select: { id: true, role: true },
      });
      if (users.length !== data.assigneeIds.length || users.some((u) => !staffOnly(u.role))) {
        return res.status(400).json({ error: 'assigneeIds must reference staff users' });
      }
    }

    const schedule = await prisma.$transaction(async (tx) => {
      await tx.schedule.update({
        where: { id: req.params.id },
        data: {
          title: data.title,
          notes: data.notes ?? undefined,
          startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
          endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
          assigneeId: data.assigneeId,
        },
      });
      if (data.assigneeIds) {
        // Replace the entire assignment set so the UI's checkbox state
        // is the source of truth. Cheapest path: nuke + recreate.
        await tx.scheduleAssignee.deleteMany({ where: { scheduleId: req.params.id } });
        if (data.assigneeIds.length > 0) {
          await tx.scheduleAssignee.createMany({
            data: data.assigneeIds.map((userId) => ({ scheduleId: req.params.id, userId })),
          });
        }
      }
      return tx.schedule.findUnique({ where: { id: req.params.id }, include: scheduleInclude });
    });
    res.json({ schedule: schedule ? withFlatAssignees(schedule) : null });
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
