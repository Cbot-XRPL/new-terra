import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({ body: z.string().min(1) });

async function loadProjectFor(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (role === Role.CUSTOMER && project.customerId !== userId) return null;
  return project;
}

router.get('/:id/logs', async (req, res, next) => {
  try {
    const project = await loadProjectFor(req.params.id, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const entries = await prisma.logEntry.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.json({ entries });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/logs',
  requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR),
  async (req, res, next) => {
    try {
      const data = createSchema.parse(req.body);
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const entry = await prisma.logEntry.create({
        data: {
          projectId: project.id,
          authorId: req.user!.sub,
          body: data.body,
        },
        include: { author: { select: { id: true, name: true, role: true } } },
      });
      res.status(201).json({ entry });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:id/logs/:entryId', async (req, res, next) => {
  try {
    const entry = await prisma.logEntry.findUnique({ where: { id: req.params.entryId } });
    if (!entry || entry.projectId !== req.params.id) {
      return res.status(404).json({ error: 'Log entry not found' });
    }
    // Authors can delete their own entries; admins can delete any.
    if (entry.authorId !== req.user!.sub && req.user!.role !== Role.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.logEntry.delete({ where: { id: entry.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
