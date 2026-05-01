// Sketch CRUD scoped under an estimate. Mounted at
// /api/estimates/:estimateId/sketch by app.ts.
//
// Three endpoints:
//   GET  → returns the sketch JSON + persisted totals (or null)
//   PUT  → upsert the sketch with validation + recomputed totals
//   POST /push-to-estimate → derives line items from the sketch and
//        appends them to the estimate's lines, recomputing totals.
//
// All gated behind hasSalesAccess (sales reps + admins only).

import { Router } from 'express';
import { Role, EstimateStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';
import { parseSketch, sketchTotals } from '../lib/sketchMath.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function loadEditable(estimateId: string, userId: string, isAdmin: boolean) {
  const est = await prisma.estimate.findUnique({ where: { id: estimateId } });
  if (!est) return null;
  if (est.status !== EstimateStatus.DRAFT) return null;
  if (!isAdmin && est.createdById !== userId) return null;
  return est;
}

router.get('/', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const est = await prisma.estimate.findUnique({ where: { id: req.params.estimateId } });
    if (!est) return res.status(404).json({ error: 'Estimate not found' });
    if (me.role !== Role.ADMIN && est.createdById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const sketch = await (prisma as any).estimateSketch.findUnique({
      where: { estimateId: est.id },
    });
    res.json({ sketch });
  } catch (err) {
    next(err);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const est = await loadEditable(req.params.estimateId, me.id, me.role === Role.ADMIN);
    if (!est) return res.status(404).json({ error: 'Estimate not found or locked' });

    let parsed;
    try {
      parsed = parseSketch(req.body?.data ?? req.body);
    } catch (validationErr) {
      const msg = validationErr instanceof Error ? validationErr.message : 'Invalid sketch';
      return res.status(400).json({ error: msg });
    }
    const totals = sketchTotals(parsed);

    const sketch = await (prisma as any).estimateSketch.upsert({
      where: { estimateId: est.id },
      create: {
        estimateId: est.id,
        data: parsed as never,
        ...totals,
      },
      update: {
        data: parsed as never,
        ...totals,
      },
    });
    res.json({ sketch });
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const est = await loadEditable(req.params.estimateId, me.id, me.role === Role.ADMIN);
    if (!est) return res.status(404).json({ error: 'Estimate not found or locked' });
    await (prisma as any).estimateSketch.deleteMany({ where: { estimateId: est.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Push the sketch's derived totals into the estimate as new line items.
// Naive first cut — appends a few "from sketch" rows at the bottom of
// the line list using catalog-free freeform descriptions. The sales
// rep can then edit / replace with catalog products. Future versions
// can map sketch buckets (floor / wall / ceiling) to specific catalog
// product ids that the admin nominates.
router.post('/push-to-estimate', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const est = await loadEditable(req.params.estimateId, me.id, me.role === Role.ADMIN);
    if (!est) return res.status(404).json({ error: 'Estimate not found or locked' });

    const sketch = await (prisma as any).estimateSketch.findUnique({
      where: { estimateId: est.id },
    });
    if (!sketch) return res.status(404).json({ error: 'No sketch on this estimate yet' });

    const cur = await prisma.estimateLine.findMany({
      where: { estimateId: est.id },
      select: { position: true },
    });
    const startPos = cur.reduce((m, l) => Math.max(m, l.position), -1) + 1;

    // Default per-unit prices left at 0 — sales rep fills them in. The
    // value here is the QUANTITY auto-derived from the sketch; the rep
    // doesn't have to re-measure.
    const newLines: Array<{
      description: string;
      quantity: number;
      unit: string;
      unitPriceCents: number;
      totalCents: number;
      category: 'Labor' | 'Materials';
      position: number;
    }> = [];
    let pos = startPos;
    if (sketch.floorSqft > 0) {
      newLines.push({
        description: `Floor area (from sketch)`,
        quantity: sketch.floorSqft,
        unit: 'sqft',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (sketch.wallSqft > 0) {
      newLines.push({
        description: `Wall area, openings subtracted (from sketch)`,
        quantity: sketch.wallSqft,
        unit: 'sqft',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (sketch.ceilingSqft > 0) {
      newLines.push({
        description: `Ceiling area (from sketch)`,
        quantity: sketch.ceilingSqft,
        unit: 'sqft',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (sketch.perimeterFeet > 0) {
      newLines.push({
        description: `Baseboard / trim run (from sketch perimeter)`,
        quantity: sketch.perimeterFeet,
        unit: 'lf',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }

    if (newLines.length === 0) {
      return res.status(400).json({ error: 'Sketch is empty — add a room first' });
    }

    await prisma.estimateLine.createMany({
      data: newLines.map((l) => ({
        estimateId: est.id,
        ...l,
      })),
    });
    res.json({ added: newLines.length });
  } catch (err) {
    next(err);
  }
});

export default router;
