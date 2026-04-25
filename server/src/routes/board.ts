import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR));

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  pinned: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

router.get('/', async (_req, res, next) => {
  try {
    const posts = await prisma.messageBoardPost.findMany({
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.json({ posts });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    // Only admins may pin posts; ignore the field for everyone else.
    const pinned = req.user!.role === Role.ADMIN ? data.pinned ?? false : false;
    const post = await prisma.messageBoardPost.create({
      data: {
        title: data.title,
        body: data.body,
        pinned,
        authorId: req.user!.sub,
      },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const post = await prisma.messageBoardPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    // Authors edit their own; admins edit anything.
    if (post.authorId !== req.user!.sub && req.user!.role !== Role.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pinned = req.user!.role === Role.ADMIN ? data.pinned : undefined;
    const updated = await prisma.messageBoardPost.update({
      where: { id: post.id },
      data: { title: data.title, body: data.body, pinned },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.json({ post: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const post = await prisma.messageBoardPost.findUnique({ where: { id: req.params.id } });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.authorId !== req.user!.sub && req.user!.role !== Role.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.messageBoardPost.delete({ where: { id: post.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
