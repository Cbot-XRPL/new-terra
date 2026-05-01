import { Router } from 'express';
import { z } from 'zod';
import { Role, SelectionStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  category: z.string().min(1),
  option: z.string().min(1),
  notes: z.string().optional(),
});

const customerUpdateSchema = z.object({
  status: z.enum([SelectionStatus.APPROVED, SelectionStatus.CHANGE_REQUESTED]),
  notes: z.string().optional(),
});

const staffUpdateSchema = z.object({
  category: z.string().optional(),
  option: z.string().optional(),
  notes: z.string().nullable().optional(),
  status: z.nativeEnum(SelectionStatus).optional(),
});

async function loadProjectFor(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (role === Role.CUSTOMER) {
    return project.customerId === userId ? project : null;
  }
  // Subs / photographers shouldn't see customer finish selections on
  // jobs they aren't assigned to. Photographer in particular has no
  // business reading these — keep parity with the other project-scoped
  // routes by requiring a schedule assignment.
  if (role === Role.SUBCONTRACTOR || role === Role.PHOTOGRAPHER) {
    const assigned = await prisma.schedule.count({
      where: {
        projectId: project.id,
        OR: [
          { assigneeId: userId },
          { assignees: { some: { userId } } },
        ],
      },
    });
    if (assigned === 0) return null;
  }
  return project;
}

router.get('/:id/selections', async (req, res, next) => {
  try {
    const project = await loadProjectFor(req.params.id, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const selections = await prisma.selection.findMany({
      where: { projectId: project.id },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ selections });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/selections',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body);
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const selection = await prisma.selection.create({
        data: {
          projectId: project.id,
          customerId: project.customerId,
          category: data.category,
          option: data.option,
          notes: data.notes,
        },
      });
      res.status(201).json({ selection });
    } catch (err) {
      next(err);
    }
  },
);

// One handler that branches on role: customer can only update status (decide),
// staff can edit the selection itself.
router.patch('/:id/selections/:selectionId', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const sel = await prisma.selection.findUnique({ where: { id: req.params.selectionId } });
    if (!sel || sel.projectId !== req.params.id) {
      return res.status(404).json({ error: 'Selection not found' });
    }

    if (role === Role.CUSTOMER) {
      if (sel.customerId !== sub) return res.status(404).json({ error: 'Selection not found' });
      const data = customerUpdateSchema.parse(req.body);
      const updated = await prisma.selection.update({
        where: { id: sel.id },
        data: {
          status: data.status,
          notes: data.notes ?? sel.notes,
          decidedAt: new Date(),
        },
      });
      return res.json({ selection: updated });
    }

    if (role !== Role.ADMIN && role !== Role.EMPLOYEE) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = staffUpdateSchema.parse(req.body);
    const updated = await prisma.selection.update({
      where: { id: sel.id },
      data: {
        category: data.category,
        option: data.option,
        notes: data.notes === null ? null : data.notes,
        status: data.status,
        decidedAt: data.status && data.status !== SelectionStatus.PENDING ? new Date() : undefined,
      },
    });
    res.json({ selection: updated });
  } catch (err) {
    next(err);
  }
});

router.delete(
  '/:id/selections/:selectionId',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const sel = await prisma.selection.findUnique({ where: { id: req.params.selectionId } });
      if (!sel || sel.projectId !== req.params.id) {
        return res.status(404).json({ error: 'Selection not found' });
      }
      await prisma.selection.delete({ where: { id: sel.id } });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
