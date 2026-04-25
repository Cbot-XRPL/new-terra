import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canManageProject } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({ body: z.string().min(1).max(5000) });

router.get('/:id/comments', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me || !canManageProject(me, project).read) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const comments = await prisma.projectComment.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me || !canManageProject(me, project).read) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const comment = await prisma.projectComment.create({
      data: { projectId: project.id, authorId: me.id, body: data.body },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/comments/:commentId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const comment = await prisma.projectComment.findUnique({
      where: { id: req.params.commentId },
    });
    if (!comment || comment.projectId !== project.id) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    // Authors delete their own; admins delete any.
    if (comment.authorId !== me.id && me.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.projectComment.delete({ where: { id: comment.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
