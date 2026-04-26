import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';
import { expandAssembly } from '../lib/assemblies.js';

const router = Router();
router.use(requireAuth);

// ----- Products -----

const productSchema = z.object({
  sku: z.string().max(60).nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  kind: z.string().max(40).optional(),
  unit: z.string().max(20).optional(),
  defaultUnitPriceCents: z.number().int().nonnegative().default(0),
  category: z.string().max(80).optional(),
  vendorId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

router.get('/products', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const includeArchived = req.query.archived === 'true';
    const q = (req.query.q as string | undefined)?.trim();
    const category = (req.query.category as string | undefined)?.trim();
    const kind = (req.query.kind as string | undefined)?.trim();

    const where: Record<string, unknown> = includeArchived ? {} : { active: true };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = category;
    if (kind) where.kind = kind;

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      include: { vendor: { select: { id: true, name: true } } },
      take: 500,
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

router.post('/products', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = productSchema.parse(req.body);
    if (data.sku) {
      const existing = await prisma.product.findUnique({ where: { sku: data.sku } });
      if (existing) return res.status(409).json({ error: 'A product with that SKU already exists' });
    }
    const product = await prisma.product.create({
      data: {
        sku: data.sku ?? null,
        name: data.name,
        description: data.description,
        kind: data.kind ?? 'material',
        unit: data.unit,
        defaultUnitPriceCents: data.defaultUnitPriceCents,
        category: data.category,
        vendorId: data.vendorId ?? null,
        active: data.active ?? true,
        notes: data.notes,
      },
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

router.patch('/products/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = productSchema.partial().parse(req.body);
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        sku: data.sku === null ? null : data.sku,
        name: data.name,
        description: data.description,
        kind: data.kind,
        unit: data.unit,
        defaultUnitPriceCents: data.defaultUnitPriceCents,
        category: data.category,
        vendorId: data.vendorId === null ? null : data.vendorId,
        active: data.active,
        notes: data.notes,
      },
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

// ----- Assemblies -----

const assemblyLineSchema = z
  .object({
    productId: z.string().nullable().optional(),
    subAssemblyId: z.string().nullable().optional(),
    quantity: z.number().nonnegative().default(0),
    unitPriceOverrideCents: z.number().int().nonnegative().nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    category: z.string().max(80).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .refine(
    (l) => !(l.productId && l.subAssemblyId),
    { message: 'A line cannot reference both a product and a sub-assembly' },
  )
  .refine(
    (l) => l.productId || l.subAssemblyId || l.description,
    { message: 'A freeform line needs a description' },
  );

const assemblySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  active: z.boolean().optional(),
  imageUrl: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(assemblyLineSchema).default([]),
});

router.get('/assemblies', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const includeArchived = req.query.archived === 'true';
    const q = (req.query.q as string | undefined)?.trim();
    const category = (req.query.category as string | undefined)?.trim();

    const where: Record<string, unknown> = includeArchived ? {} : { active: true };
    if (q) where.name = { contains: q, mode: 'insensitive' };
    if (category) where.category = category;

    const assemblies = await prisma.assembly.findMany({
      where,
      orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { lines: true } } },
      take: 500,
    });
    res.json({ assemblies });
  } catch (err) {
    next(err);
  }
});

router.get('/assemblies/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const assembly = await prisma.assembly.findUnique({
      where: { id: req.params.id },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: {
            product: { select: { id: true, name: true, unit: true, defaultUnitPriceCents: true, category: true } },
            subAssembly: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!assembly) return res.status(404).json({ error: 'Assembly not found' });
    res.json({ assembly });
  } catch (err) {
    next(err);
  }
});

// Preview the expanded line list (and rolled-up totals) for a given
// assembly without inserting anything anywhere. Used by the picker UI.
router.get('/assemblies/:id/preview', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    try {
      const lines = await expandAssembly(req.params.id);
      const totalCents = lines.reduce((s, l) => s + l.totalCents, 0);
      res.json({ lines, totalCents });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Assembly cycle')) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.post('/assemblies', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = assemblySchema.parse(req.body);
    const assembly = await prisma.assembly.create({
      data: {
        name: data.name,
        description: data.description,
        category: data.category,
        active: data.active ?? true,
        imageUrl: data.imageUrl,
        notes: data.notes,
        lines: {
          create: data.lines.map((l, idx) => ({
            productId: l.productId ?? null,
            subAssemblyId: l.subAssemblyId ?? null,
            quantity: l.quantity,
            unitPriceOverrideCents: l.unitPriceOverrideCents ?? null,
            description: l.description ?? null,
            category: l.category ?? null,
            notes: l.notes ?? null,
            position: l.position ?? idx,
          })),
        },
      },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    res.status(201).json({ assembly });
  } catch (err) {
    next(err);
  }
});

router.patch('/assemblies/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = assemblySchema.partial().parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.assembly.update({
        where: { id: req.params.id },
        data: {
          name: data.name,
          description: data.description,
          category: data.category,
          active: data.active,
          imageUrl: data.imageUrl,
          notes: data.notes,
        },
      });
      if (data.lines) {
        await tx.assemblyLine.deleteMany({ where: { assemblyId: req.params.id } });
        if (data.lines.length > 0) {
          await tx.assemblyLine.createMany({
            data: data.lines.map((l, idx) => ({
              assemblyId: req.params.id,
              productId: l.productId ?? null,
              subAssemblyId: l.subAssemblyId ?? null,
              quantity: l.quantity,
              unitPriceOverrideCents: l.unitPriceOverrideCents ?? null,
              description: l.description ?? null,
              category: l.category ?? null,
              notes: l.notes ?? null,
              position: l.position ?? idx,
            })),
          });
        }
      }
      return tx.assembly.findUnique({
        where: { id: req.params.id },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
    });
    res.json({ assembly: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/assemblies/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const assembly = await prisma.assembly.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.json({ assembly });
  } catch (err) {
    next(err);
  }
});

export default router;
