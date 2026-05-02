// Roof-sketch CRUD scoped under an estimate. Mounted at
// /api/estimates/:estimateId/roof-sketch by app.ts.
//
// Mirrors estimateSketch.ts (the floor sketch). Differences:
//   - The shape is a list of facets (polygons + integer pitch), not rooms.
//   - Push-to-estimate maps the pitch-corrected totals to roofing line
//     items (shingles, drip edge, ridge cap, valley flashing, gutter).
//
// All gated behind hasSalesAccess; only writable on DRAFT estimates.
//
// We use `(prisma as any).estimateRoofSketch` because the model is added
// in this same change — the dev's deploy script runs `prisma generate`
// at deploy time, and the cast lets the TS build pass beforehand.

import { Router } from 'express';
import { Role, EstimateStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';
import { parseRoofSketch, roofTotals } from '../lib/roofMath.js';

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
    const sketch = await (prisma as any).estimateRoofSketch.findUnique({
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
      parsed = parseRoofSketch(req.body?.data ?? req.body);
    } catch (validationErr) {
      const msg = validationErr instanceof Error ? validationErr.message : 'Invalid roof sketch';
      return res.status(400).json({ error: msg });
    }
    const totals = roofTotals(parsed);

    const sketch = await (prisma as any).estimateRoofSketch.upsert({
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
    await (prisma as any).estimateRoofSketch.deleteMany({ where: { estimateId: est.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Push the roof sketch's derived totals into the estimate as new line
// items. Same shape as the floor sketch's push: quantity is auto-derived,
// unit price is left at 0 for the sales rep to fill in. Lines whose
// quantity is 0 are skipped — no point cluttering the estimate with empty
// "Valley flashing — 0 lf" rows.
router.post('/push-to-estimate', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const est = await loadEditable((req.params as { estimateId: string }).estimateId, me.id, me.role === Role.ADMIN);
    if (!est) return res.status(404).json({ error: 'Estimate not found or locked' });

    // Section grouping — same pattern as the floor sketch push.
    const body = (req.body ?? {}) as { sectionTitle?: string; sectionNotes?: string };
    const sectionTitle = (body.sectionTitle ?? 'Roof').toString().slice(0, 120) || 'Roof';
    const sectionNotes = body.sectionNotes ? body.sectionNotes.toString().slice(0, 400) : null;

    const sketch = await (prisma as any).estimateRoofSketch.findUnique({
      where: { estimateId: est.id },
    });
    if (!sketch) return res.status(404).json({ error: 'No roof sketch on this estimate yet' });

    const cur = await prisma.estimateLine.findMany({
      where: { estimateId: est.id },
      select: { position: true },
    });
    const startPos = cur.reduce((m, l) => Math.max(m, l.position), -1) + 1;

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

    const dripEdgeFt = (sketch.eaveFeet as number) + (sketch.rakeFeet as number);
    const ridgeCapFt = (sketch.ridgeFeet as number) + (sketch.hipFeet as number);

    if (sketch.surfaceSqft > 0) {
      newLines.push({
        description: 'Shingles / underlayment (from roof sketch)',
        quantity: sketch.surfaceSqft,
        unit: 'sqft',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (dripEdgeFt > 0) {
      newLines.push({
        description: 'Drip edge (from roof sketch — eaves + rakes)',
        quantity: dripEdgeFt,
        unit: 'lf',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (ridgeCapFt > 0) {
      newLines.push({
        description: 'Ridge cap (from roof sketch — ridges + hips)',
        quantity: ridgeCapFt,
        unit: 'lf',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (sketch.valleyFeet > 0) {
      newLines.push({
        description: 'Valley flashing (from roof sketch)',
        quantity: sketch.valleyFeet,
        unit: 'lf',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }
    if (sketch.eaveFeet > 0) {
      newLines.push({
        description: 'Gutter (from roof sketch — eaves)',
        quantity: sketch.eaveFeet,
        unit: 'lf',
        unitPriceCents: 0,
        totalCents: 0,
        category: 'Materials',
        position: pos++,
      });
    }

    if (newLines.length === 0) {
      return res.status(400).json({ error: 'Roof sketch is empty — add a facet first' });
    }

    await prisma.estimateLine.createMany({
      data: newLines.map((l, idx) => ({
        estimateId: est.id,
        ...l,
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
