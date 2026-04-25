import { Router } from 'express';
import { z } from 'zod';
import { ProjectStatus, Role, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { canManageProject, hasProjectManagerCapability } from '../lib/permissions.js';

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
    const projects = await prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        ...projectInclude,
        _count: { select: { schedules: true, invoices: true, images: true, contracts: true } },
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
    res.json({ project });
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

export default router;
