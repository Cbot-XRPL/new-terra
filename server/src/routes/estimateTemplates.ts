import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

const lineSchema = z.object({
  description: z.string().min(1).max(500),
  defaultQuantity: z.number().nonnegative().default(0),
  unit: z.string().max(20).optional(),
  unitPriceCents: z.number().int().nonnegative().default(0),
  category: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
  position: z.number().int().nonnegative().default(0),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(80).optional(),
  active: z.boolean().optional(),
  lines: z.array(lineSchema).default([]),
});

const updateSchema = createSchema.partial();

// Read access — admin + any sales-flagged employee. Sales reps need to see
// templates so they can pick one when starting an estimate.
router.get('/', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const includeArchived = req.query.archived === 'true';
    const templates = await prisma.estimateTemplate.findMany({
      where: includeArchived ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { lines: true, estimates: true } },
      },
    });
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const template = await prisma.estimateTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        lines: { orderBy: { position: 'asc' } },
      },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const template = await prisma.estimateTemplate.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        active: data.active ?? true,
        createdById: req.user!.sub,
        lines: {
          create: data.lines.map((l, idx) => ({
            description: l.description,
            defaultQuantity: l.defaultQuantity,
            unit: l.unit,
            unitPriceCents: l.unitPriceCents,
            category: l.category,
            notes: l.notes,
            position: l.position ?? idx,
          })),
        },
      },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
});

// Update — replaces lines wholesale. Simpler than diffing and matches how
// admins actually work (open template, edit, save).
router.patch('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.estimateTemplate.update({
        where: { id: req.params.id },
        data: {
          name: data.name,
          description: data.description,
          category: data.category,
          active: data.active,
        },
      });
      if (data.lines) {
        await tx.estimateTemplateLine.deleteMany({ where: { templateId: req.params.id } });
        if (data.lines.length > 0) {
          await tx.estimateTemplateLine.createMany({
            data: data.lines.map((l, idx) => ({
              templateId: req.params.id,
              description: l.description,
              defaultQuantity: l.defaultQuantity,
              unit: l.unit,
              unitPriceCents: l.unitPriceCents,
              category: l.category,
              notes: l.notes,
              position: l.position ?? idx,
            })),
          });
        }
      }
      return tx.estimateTemplate.findUnique({
        where: { id: req.params.id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
    });
    res.json({ template: updated });
  } catch (err) {
    next(err);
  }
});

// Soft archive — keeps existing estimates' template snapshot intact.
router.delete('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const template = await prisma.estimateTemplate.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

export default router;
