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
  // Optional labor + material split. Default 0/0 means "lump" — no
  // breakdown — and the row behaves exactly as before. When admin
  // populates either, downstream rollups can split labor vs material.
  defaultLaborCents: z.number().int().nonnegative().optional(),
  defaultMaterialCents: z.number().int().nonnegative().optional(),
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
        defaultLaborCents: data.defaultLaborCents ?? 0,
        defaultMaterialCents: data.defaultMaterialCents ?? 0,
        category: data.category,
        vendorId: data.vendorId ?? null,
        active: data.active ?? true,
        notes: data.notes,
      } as never,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

router.patch('/products/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = productSchema.partial().parse(req.body);
    // Capture the prior price so we can log a history row when it actually
    // changes. Skip the log when price isn't in the patch (admin is just
    // renaming or moving categories).
    const before = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { defaultUnitPriceCents: true },
    });
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        sku: data.sku === null ? null : data.sku,
        name: data.name,
        description: data.description,
        kind: data.kind,
        unit: data.unit,
        defaultUnitPriceCents: data.defaultUnitPriceCents,
        defaultLaborCents: data.defaultLaborCents,
        defaultMaterialCents: data.defaultMaterialCents,
        category: data.category,
        vendorId: data.vendorId === null ? null : data.vendorId,
        active: data.active,
        notes: data.notes,
      } as never,
    });
    if (before && data.defaultUnitPriceCents !== undefined
        && data.defaultUnitPriceCents !== before.defaultUnitPriceCents) {
      await prisma.productPriceHistory.create({
        data: {
          productId: product.id,
          oldPriceCents: before.defaultUnitPriceCents,
          newPriceCents: data.defaultUnitPriceCents,
          changedById: req.user!.sub,
        },
      }).catch(() => undefined);
    }
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

// Read endpoint for the per-product price-history timeline. Surfaced on
// the catalog UI as a small drawer when the user clicks the price.
router.get('/products/:id/price-history', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (!hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const history = await prisma.productPriceHistory.findMany({
      where: { productId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { changedBy: { select: { id: true, name: true } } },
      take: 100,
    });
    res.json({ history });
  } catch (err) { next(err); }
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

// ----- Bulk edit -----
//
// Single endpoint per resource with a discriminated `action` so the admin UI
// can roll up many tiny edits into one round trip. Every action runs inside
// a transaction so a half-finished bump can't leave the catalog inconsistent.

const productBulkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('priceBump'),
    ids: z.array(z.string().min(1)).min(1),
    // Percent change as a signed decimal: 5 = +5%, -10 = -10%. We round
    // half-away-from-zero to whole cents.
    percent: z.number().refine((n) => Number.isFinite(n) && n > -100 && n < 1000, {
      message: 'percent must be between -100 and 1000',
    }),
  }),
  z.object({
    action: z.literal('setCategory'),
    ids: z.array(z.string().min(1)).min(1),
    category: z.string().max(80).nullable(),
  }),
  z.object({
    action: z.literal('setVendor'),
    ids: z.array(z.string().min(1)).min(1),
    vendorId: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal('archive'),
    ids: z.array(z.string().min(1)).min(1),
    active: z.boolean(),
  }),
]);

router.post('/products/_bulk', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const body = productBulkSchema.parse(req.body);

    if (body.action === 'priceBump') {
      // Pull current prices, multiply, write back. We round each row
      // independently so $9.99 + 5% lands on $10.49 instead of accumulating
      // floating-point fuzz across the set.
      const factor = 1 + body.percent / 100;
      const updated = await prisma.$transaction(async (tx) => {
        const rows = await tx.product.findMany({
          where: { id: { in: body.ids } },
          select: { id: true, defaultUnitPriceCents: true },
        });
        for (const r of rows) {
          const next = Math.max(0, Math.round(r.defaultUnitPriceCents * factor));
          if (next === r.defaultUnitPriceCents) continue;
          await tx.product.update({
            where: { id: r.id },
            data: { defaultUnitPriceCents: next },
          });
          // Log the bulk bump in price history so admin can spot 'all
          // lumber went up 5% on 4/26' without diffing manually.
          await tx.productPriceHistory.create({
            data: {
              productId: r.id,
              oldPriceCents: r.defaultUnitPriceCents,
              newPriceCents: next,
              changedById: req.user!.sub,
              notes: `Bulk price bump (${body.percent > 0 ? '+' : ''}${body.percent}%)`,
            },
          });
        }
        return rows.length;
      });
      return res.json({ action: body.action, updated });
    }

    if (body.action === 'setCategory') {
      const r = await prisma.product.updateMany({
        where: { id: { in: body.ids } },
        data: { category: body.category },
      });
      return res.json({ action: body.action, updated: r.count });
    }

    if (body.action === 'setVendor') {
      // Validate the vendor exists so a typo doesn't orphan a product. Null
      // clears the relationship.
      if (body.vendorId) {
        const exists = await prisma.vendor.findUnique({ where: { id: body.vendorId } });
        if (!exists) return res.status(400).json({ error: 'Vendor not found' });
      }
      const r = await prisma.product.updateMany({
        where: { id: { in: body.ids } },
        data: { vendorId: body.vendorId },
      });
      return res.json({ action: body.action, updated: r.count });
    }

    // archive / unarchive
    const r = await prisma.product.updateMany({
      where: { id: { in: body.ids } },
      data: { active: body.active },
    });
    return res.json({ action: body.action, updated: r.count });
  } catch (err) {
    next(err);
  }
});

const assemblyBulkSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setCategory'),
    ids: z.array(z.string().min(1)).min(1),
    category: z.string().max(80).nullable(),
  }),
  z.object({
    action: z.literal('archive'),
    ids: z.array(z.string().min(1)).min(1),
    active: z.boolean(),
  }),
]);

router.post('/assemblies/_bulk', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const body = assemblyBulkSchema.parse(req.body);
    if (body.action === 'setCategory') {
      const r = await prisma.assembly.updateMany({
        where: { id: { in: body.ids } },
        data: { category: body.category },
      });
      return res.json({ action: body.action, updated: r.count });
    }
    const r = await prisma.assembly.updateMany({
      where: { id: { in: body.ids } },
      data: { active: body.active },
    });
    return res.json({ action: body.action, updated: r.count });
  } catch (err) {
    next(err);
  }
});

export default router;
