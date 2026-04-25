import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ----- Helpers -----

function isStaff(role: Role) {
  return role === Role.ADMIN || role === Role.EMPLOYEE || role === Role.SUBCONTRACTOR;
}

// Customers can only see projects where they're the customer.
// Staff can see all projects (subcontractor scoping can come later if needed).
async function loadProjectForUser(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      customer: { select: { id: true, name: true, email: true } },
    },
  });
  if (!project) return null;
  if (role === Role.CUSTOMER && project.customerId !== userId) return null;
  return project;
}

// ----- Projects -----

const createProjectSchema = z.object({
  name: z.string().min(1),
  customerId: z.string().min(1),
  address: z.string().optional(),
  description: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const updateProjectSchema = createProjectSchema.partial().omit({ customerId: true });

router.get('/', async (req, res, next) => {
  try {
    const { sub: userId, role } = req.user!;
    const where = role === Role.CUSTOMER ? { customerId: userId } : {};
    const projects = await prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        _count: { select: { schedules: true, invoices: true, images: true } },
      },
    });
    res.json({ projects });
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
    const project = await prisma.project.create({
      data: {
        name: data.name,
        customerId: data.customerId,
        address: data.address,
        description: data.description,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
      include: { customer: { select: { id: true, name: true, email: true } } },
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
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = updateProjectSchema.parse(req.body);
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
      include: { customer: { select: { id: true, name: true, email: true } } },
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

router.post(
  '/:id/schedules',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const data = createScheduleSchema.parse(req.body);
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Project not found' });

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
  },
);

export default router;
