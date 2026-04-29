import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR));

// Channel name shape — Discord-style: lowercase, dashes, no spaces. Avoids
// confusion when admins type 'Field updates' vs 'field-updates'.
const NAME_RE = /^[a-z0-9-]+$/;

const createSchema = z.object({
  name: z.string().min(1).max(40).regex(NAME_RE, 'Lowercase letters, digits, and dashes only'),
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(40).regex(NAME_RE).optional(),
  description: z.string().max(500).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  archived: z.boolean().optional(),
});

// Read — anyone with board access (already gated by requireRole above).
router.get('/', async (_req, res, next) => {
  try {
    const channels = await prisma.channel.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { posts: true } } },
    });
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

// Admin-only mutations below.
router.post('/', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    // Position the new channel at the end of the list.
    const last = await prisma.channel.findFirst({
      where: { archivedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    try {
      const channel = await prisma.channel.create({
        data: {
          name: data.name,
          description: data.description,
          position: (last?.position ?? -1) + 1,
          createdById: req.user!.sub,
        },
      });
      res.status(201).json({ channel });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return res.status(409).json({ error: `Channel "${data.name}" already exists` });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const existing = await prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Channel not found' });
    const data = updateSchema.parse(req.body);
    try {
      const channel = await prisma.channel.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          description: data.description === null ? null : data.description,
          position: data.position,
          archivedAt:
            data.archived === undefined
              ? undefined
              : data.archived
                ? new Date()
                : null,
        },
      });
      res.json({ channel });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return res.status(409).json({ error: `Channel "${data.name}" already exists` });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Hard delete cascades posts (per onDelete: Cascade in the schema). Admin
// hits Archive first if they want to keep history.
router.delete('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const existing = await prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Channel not found' });
    // Block deleting the last remaining channel — there'd be nowhere for
    // people to post.
    const liveCount = await prisma.channel.count({ where: { archivedAt: null } });
    if (liveCount <= 1 && existing.archivedAt === null) {
      return res
        .status(409)
        .json({ error: 'Cannot delete the last channel — create another one first.' });
    }
    await prisma.channel.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
