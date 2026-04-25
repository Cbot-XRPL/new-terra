import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const variableSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key must be a simple identifier'),
  label: z.string().min(1).max(120),
  required: z.boolean().optional(),
  multiline: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  body: z.string().min(1),
  variables: z.array(variableSchema).default([]),
  active: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

// Reading templates is allowed to admin + sales-flagged employees so they
// can pick a template when drafting a contract.
function canRead(role: Role, isSales: boolean) {
  return role === Role.ADMIN || (role === Role.EMPLOYEE && isSales);
}

router.get('/', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !canRead(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const includeArchived = req.query.archived === 'true';
    const templates = await prisma.contractTemplate.findMany({
      where: includeArchived ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { createdBy: { select: { id: true, name: true } }, _count: { select: { contracts: true } } },
    });
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !canRead(me.role, me.isSales)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const template = await prisma.contractTemplate.findUnique({
      where: { id: req.params.id },
      include: { createdBy: { select: { id: true, name: true } } },
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
    const template = await prisma.contractTemplate.create({
      data: {
        name: data.name,
        description: data.description,
        body: data.body,
        variables: data.variables,
        active: data.active ?? true,
        createdById: req.user!.sub,
      },
    });
    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const template = await prisma.contractTemplate.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        description: data.description,
        body: data.body,
        variables: data.variables,
        active: data.active,
      },
    });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    // Soft-archive rather than hard-delete so existing contracts that snapshot
    // this template don't lose their lineage in audit views.
    const template = await prisma.contractTemplate.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

export default router;
