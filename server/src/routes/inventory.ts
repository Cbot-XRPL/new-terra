import { Router } from 'express';
import { z } from 'zod';
import { InventoryReason, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess, hasSalesAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

// Sales + accounting + admin can see inventory; subs + customers + plain
// employees stay out (it's a materials/COGS surface that overlaps with
// the catalog).
async function gateInventory(userId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId } });
  if (!me) return null;
  if (me.role === Role.CUSTOMER || me.role === Role.SUBCONTRACTOR) return null;
  if (!hasAccountingAccess(me) && !hasSalesAccess(me)) return null;
  return me;
}

router.get('/', async (req, res, next) => {
  try {
    const me = await gateInventory(req.user!.sub);
    if (!me) return res.status(403).json({ error: 'Forbidden' });

    const lowOnly = req.query.lowOnly === 'true';
    const products = await prisma.product.findMany({
      where: {
        trackInventory: true,
        ...(lowOnly
          ? { AND: [{ reorderThresholdMilli: { gt: 0 } }, { onHandQtyMilli: { lte: prisma.product.fields.reorderThresholdMilli } }] }
          : {}),
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { vendor: { select: { id: true, name: true } } },
    });

    // Prisma's relation-field comparator above doesn't work — we filter in
    // JS to keep the query simple and the dataset is small (< few hundred
    // tracked products). 'lowOnly' = onHand <= threshold && threshold > 0.
    const list = lowOnly
      ? products.filter((p) => p.reorderThresholdMilli > 0 && p.onHandQtyMilli <= p.reorderThresholdMilli)
      : products;

    res.json({
      products: list.map((p) => ({
        ...p,
        onHandQty: p.onHandQtyMilli / 1000,
        reorderThresholdQty: p.reorderThresholdMilli / 1000,
      })),
    });
  } catch (err) { next(err); }
});

const enableSchema = z.object({
  trackInventory: z.boolean().optional(),
  onHandQty: z.number().nonnegative().optional(),
  reorderThresholdQty: z.number().nonnegative().optional(),
});

router.patch('/products/:id', async (req, res, next) => {
  try {
    const me = await gateInventory(req.user!.sub);
    if (!me) return res.status(403).json({ error: 'Forbidden' });
    if (me.role !== Role.ADMIN && !me.isAccounting) {
      // Sales can read inventory but only admin/accounting can mutate.
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = enableSchema.parse(req.body);
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        trackInventory: data.trackInventory,
        onHandQtyMilli: data.onHandQty != null ? Math.round(data.onHandQty * 1000) : undefined,
        reorderThresholdMilli: data.reorderThresholdQty != null
          ? Math.round(data.reorderThresholdQty * 1000)
          : undefined,
      },
    });
    res.json({ product });
  } catch (err) { next(err); }
});

const adjustSchema = z.object({
  amountQty: z.number().refine((n) => n !== 0 && Number.isFinite(n), { message: 'amount must be non-zero' }),
  reason: z.nativeEnum(InventoryReason),
  projectId: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

// Append a ledger entry + bump Product.onHandQtyMilli atomically. Sign of
// amountQty: positive for restock/found, negative for used/loss/count-down.
router.post('/products/:id/adjust', async (req, res, next) => {
  try {
    const me = await gateInventory(req.user!.sub);
    if (!me) return res.status(403).json({ error: 'Forbidden' });
    if (me.role !== Role.ADMIN && !me.isAccounting) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = adjustSchema.parse(req.body);
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!product.trackInventory) {
      return res.status(409).json({ error: 'Inventory tracking is off for this product' });
    }
    const milli = Math.round(data.amountQty * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const adj = await tx.inventoryAdjustment.create({
        data: {
          productId: product.id,
          amountMilli: milli,
          reason: data.reason,
          projectId: data.projectId ?? null,
          notes: data.notes ?? null,
          createdById: me.id,
        },
      });
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { onHandQtyMilli: { increment: milli } },
      });
      return { adj, updated };
    });

    res.status(201).json({
      adjustment: result.adj,
      product: {
        ...result.updated,
        onHandQty: result.updated.onHandQtyMilli / 1000,
        reorderThresholdQty: result.updated.reorderThresholdMilli / 1000,
      },
    });
  } catch (err) { next(err); }
});

router.get('/products/:id/history', async (req, res, next) => {
  try {
    const me = await gateInventory(req.user!.sub);
    if (!me) return res.status(403).json({ error: 'Forbidden' });
    const adjustments = await prisma.inventoryAdjustment.findMany({
      where: { productId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
      take: 200,
    });
    res.json({
      adjustments: adjustments.map((a) => ({ ...a, amountQty: a.amountMilli / 1000 })),
    });
  } catch (err) { next(err); }
});

export default router;
