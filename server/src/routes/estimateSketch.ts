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
    const est = await prisma.estimate.findUnique({ where: { id: (req.params as { estimateId: string }).estimateId } });
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
    const est = await loadEditable((req.params as { estimateId: string }).estimateId, me.id, me.role === Role.ADMIN);
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
    const est = await loadEditable((req.params as { estimateId: string }).estimateId, me.id, me.role === Role.ADMIN);
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
    const est = await loadEditable((req.params as { estimateId: string }).estimateId, me.id, me.role === Role.ADMIN);
    if (!est) return res.status(404).json({ error: 'Estimate not found or locked' });

    // Section tagging — every line pushed in one shot lands in the same
    // section so the estimate detail can show a clean "Floor sketch" /
    // "Deck" / "Kitchen" subtotal block. Caller can override; default
    // is "Floor sketch".
    const body = (req.body ?? {}) as { sectionTitle?: string; sectionNotes?: string };
    const sectionTitle = (body.sectionTitle ?? 'Floor sketch').toString().slice(0, 120) || 'Floor sketch';
    const sectionNotes = body.sectionNotes ? body.sectionNotes.toString().slice(0, 400) : null;

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

    // Fixtures — each placed fixture becomes an "ea" line so the rep
    // can drop a price next to it. Group by label so 3 toilets land
    // as one line "Toilet × 3" instead of three rows; the rep can
    // still split later if pricing differs per unit.
    type FixtureRow = { slug: string; label: string };
    const fixtures = Array.isArray((sketch.data as { fixtures?: FixtureRow[] })?.fixtures)
      ? ((sketch.data as { fixtures?: FixtureRow[] }).fixtures ?? [])
      : [];
    const grouped = new Map<string, { count: number; label: string }>();
    for (const f of fixtures) {
      const key = `${f.slug}::${f.label ?? ''}`;
      const cur = grouped.get(key) ?? { count: 0, label: f.label || f.slug.split('/').pop() || 'Fixture' };
      cur.count += 1;
      grouped.set(key, cur);
    }
    for (const { count, label } of grouped.values()) {
      newLines.push({
        description: `${label} (from sketch fixtures)`,
        quantity: count,
        unit: 'ea',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }

    if (newLines.length === 0) {
      return res.status(400).json({ error: 'Sketch is empty — add a room or fixture first' });
    }

    await prisma.estimateLine.createMany({
      data: newLines.map((l, idx) => ({
        estimateId: est.id,
        ...l,
        // First line in the push carries the section description so
        // the renderer has something to show under the header. Later
        // lines just carry the title.
        sectionTitle,
        sectionNotes: idx === 0 ? sectionNotes : null,
      } as never)),
    });
    res.json({ added: newLines.length, sectionTitle });
  } catch (err) {
    next(err);
  }
});

export default router;
