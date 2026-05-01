import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { z } from 'zod';
import {
  ContractStatus,
  EstimateStatus,
  ProjectStatus,
  Role,
  type Prisma,
} from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';
import { sendContractInviteEmail } from '../lib/mailer.js';
import { expandAssembly } from '../lib/assemblies.js';
import { latestMaterialPrice, zipPrefixOf } from '../lib/regionalPricing.js';

const router = Router();
router.use(requireAuth);

// ----- helpers -----

async function loadMe(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

function recalcLineTotal(quantity: number, unitPriceCents: number): number {
  // Round to integer cents — fractional cents would silently round on the
  // QB push and break customer-facing totals.
  return Math.round(quantity * unitPriceCents);
}

// Customers store their address as freeform text (User.mailingAddress is
// multi-line, Lead.address is single-line) so we extract the ZIP with a
// regex rather than expecting a structured field. Returns "" when nothing
// looks like a 5-digit ZIP — the regional-pricing helpers treat empty as
// "no ZIP, fall back to defaults".
function extractZip(text: string | null | undefined): string {
  if (!text) return '';
  const m = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : '';
}

// Resolve the seed unit price for a line. Order of preference:
//   1. Per-ZIP MaterialPriceSample for productId         ← regional override
//   2. Caller-supplied unitPriceCents (kept as-is)       ← explicit user intent
//   3. Catalog product.defaultMaterialCents              ← material baseline
//   4. Catalog product.defaultUnitPriceCents             ← legacy lump price
// Always defensive: any lookup error returns the caller's value untouched.
async function resolveLineUnitPrice(
  productId: string | null | undefined,
  fallbackCents: number,
  zip: string,
): Promise<number> {
  if (!productId) return fallbackCents;
  try {
    if (zip) {
      const regional = await latestMaterialPrice(productId, zip);
      if (regional !== null && regional > 0) return regional;
    }
    // Caller already supplied a non-zero unit price → trust them.
    if (fallbackCents > 0) return fallbackCents;
    // Cast through `any` because defaultMaterialCents is part of the
    // Product model but the deploy script regenerates the Prisma client
    // — this code has to type-check before that happens.
    const product = (await (prisma as any).product.findUnique({
      where: { id: productId },
      select: { defaultMaterialCents: true, defaultUnitPriceCents: true },
    })) as { defaultMaterialCents?: number; defaultUnitPriceCents?: number } | null;
    if (!product) return fallbackCents;
    if ((product.defaultMaterialCents ?? 0) > 0) return product.defaultMaterialCents!;
    if ((product.defaultUnitPriceCents ?? 0) > 0) return product.defaultUnitPriceCents!;
    return fallbackCents;
  } catch {
    return fallbackCents;
  }
}

function recalcTotals(
  lines: Array<{ totalCents: number }>,
  taxRateBps: number,
  overheadBps: number = 0,
  profitBps: number = 0,
): {
  subtotalCents: number;
  taxCents: number;
  overheadCents: number;
  profitCents: number;
  totalCents: number;
} {
  const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
  // taxRateBps of 700 = 7.00% — divide by 10_000.
  const tax = Math.round((subtotal * taxRateBps) / 10_000);
  // Xactimate's order: O is computed off subtotal, P is computed off
  // (subtotal + O). Tax is added at the end on the pre-O&P subtotal so
  // the customer isn't taxed on the contractor's profit. Each piece is
  // independent: a 0% O&P estimate falls through with no change.
  const overhead = Math.round((subtotal * overheadBps) / 10_000);
  const profit = Math.round(((subtotal + overhead) * profitBps) / 10_000);
  return {
    subtotalCents: subtotal,
    taxCents: tax,
    overheadCents: overhead,
    profitCents: profit,
    totalCents: subtotal + overhead + profit + tax,
  };
}

// Masks an estimate for a customer-bound payload. Two transformations:
//
//   1. Contractor identity scrub — for any line attached to a contractor,
//      rewrite description to the trade label (line.displayTrade ??
//      contractor.tradeType ?? "Labor"), drop the contractor id+relation,
//      clear internal notes.
//   2. Markup application — multiply every line's unitPriceCents +
//      totalCents by (1 + markupBps/10_000) so the customer sees the
//      sale price, not our cost. Subtotal/tax/total at the estimate
//      level are recomputed from the marked-up line totals (rather than
//      scaling the stored cost-side totals separately) so rounding stays
//      consistent.
//
// Used on customer reads only — staff endpoints get the raw cost data.
function maskEstimateForCustomer<E extends {
  markupBps?: number;
  taxRateBps?: number;
  overheadBps?: number;
  profitBps?: number;
  subtotalCents?: number;
  taxCents?: number;
  overheadCents?: number;
  profitCents?: number;
  totalCents?: number;
  lines: Array<{
    description: string;
    unitPriceCents: number;
    totalCents: number;
    contractorId?: string | null;
    displayTrade?: string | null;
    notes?: string | null;
    contractor?: { id: string; name: string; tradeType: string | null } | null;
  }>;
}>(estimate: E): E {
  const markupBps = estimate.markupBps ?? 0;
  const factor = 1 + markupBps / 10_000;

  const lines = estimate.lines.map((l) => {
    const unitPriceCents = Math.round(l.unitPriceCents * factor);
    const totalCents = Math.round(l.totalCents * factor);
    if (!l.contractorId && !l.contractor) {
      return { ...l, unitPriceCents, totalCents };
    }
    const trade = l.displayTrade ?? l.contractor?.tradeType ?? 'Labor';
    return {
      ...l,
      description: trade,
      notes: null,
      contractorId: null,
      contractor: null,
      unitPriceCents,
      totalCents,
    };
  });

  // Recompute totals from the marked-up line totals so the cents tie
  // out. O&P stays visible to the customer (Xactimate-style — overhead
  // + profit are itemized on the customer's estimate, not hidden).
  // Markup is separate: it's the cost-side scrub from the contractor's
  // raw cost up to the price they're quoting; O&P is the
  // industry-standard 10/10 (or whatever they configured) on top.
  let subtotalCents = estimate.subtotalCents;
  let taxCents = estimate.taxCents;
  let overheadCents = estimate.overheadCents ?? 0;
  let profitCents = estimate.profitCents ?? 0;
  let totalCents = estimate.totalCents;
  const overheadBps = estimate.overheadBps ?? 0;
  const profitBps = estimate.profitBps ?? 0;
  if (markupBps > 0 || overheadBps > 0 || profitBps > 0) {
    subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
    const taxRateBps = estimate.taxRateBps ?? 0;
    taxCents = Math.round((subtotalCents * taxRateBps) / 10_000);
    overheadCents = Math.round((subtotalCents * overheadBps) / 10_000);
    profitCents = Math.round(((subtotalCents + overheadCents) * profitBps) / 10_000);
    totalCents = subtotalCents + overheadCents + profitCents + taxCents;
  }

  return {
    ...estimate,
    lines,
    subtotalCents,
    taxCents,
    overheadCents,
    profitCents,
    totalCents,
    // Don't leak markup info to the customer — they don't need to know.
    markupBps: 0,
  };
}

async function nextEstimateNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `EST-${year}-`;
  const last = await prisma.estimate.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

const lineInputSchema = z.object({
  id: z.string().optional(), // optional so PATCH can re-use ids
  description: z.string().min(1).max(500),
  quantity: z.number().nonnegative().default(0),
  unit: z.string().max(20).optional().nullable(),
  unitPriceCents: z.number().int().nonnegative().default(0),
  // Locked to Labor or Materials so estimate→budget grouping stays clean
  // and the PM only ever sees two real buckets. Catalog products map their
  // own kind ('labor' → Labor, anything else → Materials) before reaching
  // here. Future buckets (Subs, Fees) can be re-enabled by extending this
  // enum + the client dropdown.
  category: z.enum(['Labor', 'Materials']).default('Materials'),
  notes: z.string().max(1000).optional().nullable(),
  position: z.number().int().nonnegative().optional(),
  // Optional contractor (SUBCONTRACTOR user id) the labor flows to. Hidden
  // from customers in the read path — they only see the trade label.
  contractorId: z.string().nullable().optional(),
  // Per-line trade label override. If null we fall back to the
  // contractor's User.tradeType (or "Labor"). Lets sales flip the same
  // contractor between e.g. Demo and Framing across different lines.
  displayTrade: z.string().max(60).nullable().optional(),
  // Xactimate-style action variant: REPLACE / RR / DR / CLEAN. Free-form
  // so we don't have to ship a migration to add another variant.
  action: z.string().max(20).nullable().optional(),
  // Optional catalog product id this line is sourced from. When set we
  // try to seed the unit price from regional pricing samples before
  // falling back to the catalog default — see resolveLineUnitPrice().
  productId: z.string().nullable().optional(),
});

const createSchema = z.object({
  templateId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  scope: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  termsText: z.string().max(5000).optional(),
  taxRateBps: z.number().int().min(0).max(10_000).optional(),
  // Sales markup in basis points applied to every line at customer view
  // time. 1500 = 15%. Cap at 100% (10_000 bps) — anything above that is
  // almost certainly a typo and would scare a customer.
  markupBps: z.number().int().min(0).max(10_000).optional(),
  // Overhead + Profit in basis points. Default 1000/1000 (10/10) to
  // match Xactimate's residential default. Cap at 50% each — anything
  // higher is almost certainly a fat-finger that would tank the deal.
  overheadBps: z.number().int().min(0).max(5_000).optional(),
  profitBps: z.number().int().min(0).max(5_000).optional(),
  validUntil: z.string().datetime().optional().nullable(),
  // Lines optional on create — when a templateId is provided we'll seed
  // from the template's lines.
  lines: z.array(lineInputSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  lines: z.array(lineInputSchema).optional(),
});

const acceptSchema = z.object({
  signatureName: z.string().min(2).max(120),
});

const declineSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ----- list / detail -----

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(EstimateStatus).optional(),
  q: z.string().trim().optional(),
});

// Estimates that converted into a particular project — used by the project
// hub to show the originating estimate as a reference next to the budget.
router.get('/by-project/:projectId', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    // Customers see this only on their own projects (and we mask cost
     // / margin fields below). Staff who can see estimate cost: admin,
     // sales, PM, accounting. Plain employees and subs/photographers
     // shouldn't see the contractor cost basis on a project's estimates.
    const isCustomer = me.role === Role.CUSTOMER && project.customerId === me.id;
    const isPrivilegedStaff =
      me.role === Role.ADMIN ||
      (me.role === Role.EMPLOYEE && (me.isSales || me.isProjectManager || me.isAccounting));
    if (!isCustomer && !isPrivilegedStaff) return res.status(403).json({ error: 'Forbidden' });

    const estimates = await prisma.estimate.findMany({
      where: { convertedProjectId: project.id },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        lines: {
          orderBy: { position: 'asc' },
          include: { contractor: { select: { id: true, name: true, tradeType: true } } },
        },
      },
    });
    res.json({ estimates: isCustomer ? estimates.map(maskEstimateForCustomer) : estimates });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    const q = listQuery.parse(req.query);

    let where: Prisma.EstimateWhereInput = {};
    if (me.role === Role.CUSTOMER) {
      // Customers see only estimates that have actually been sent to them.
      where = {
        customerId: me.id,
        status: { in: [EstimateStatus.SENT, EstimateStatus.VIEWED, EstimateStatus.ACCEPTED, EstimateStatus.DECLINED, EstimateStatus.CONVERTED] },
      };
    } else if (hasSalesAccess(me)) {
      where = me.role === Role.ADMIN ? {} : { createdById: me.id };
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (q.status) where.status = q.status;
    if (q.q) {
      where.OR = [
        { number: { contains: q.q, mode: 'insensitive' } },
        { title: { contains: q.q, mode: 'insensitive' } },
        { customer: { name: { contains: q.q, mode: 'insensitive' } } },
        { lead: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    }

    const [estimates, total] = await Promise.all([
      prisma.estimate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          customer: { select: { id: true, name: true, email: true } },
          lead: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.estimate.count({ where }),
    ]);
    res.json({ estimates, total, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });

    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        // Pull the contractor relation so we can resolve the trade label.
        // Staff still see the contractor directly; customers get masked.
        lines: {
          orderBy: { position: 'asc' },
          include: { contractor: { select: { id: true, name: true, tradeType: true } } },
        },
        convertedProject: { select: { id: true, name: true } },
        convertedContract: { select: { id: true, status: true } },
      },
    });
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    if (me.role === Role.CUSTOMER) {
      if (estimate.customerId !== me.id) return res.status(404).json({ error: 'Estimate not found' });
      // Hide drafts from customers.
      if (estimate.status === EstimateStatus.DRAFT) {
        return res.status(404).json({ error: 'Estimate not found' });
      }
      // Stamp viewedAt on first read.
      if (estimate.status === EstimateStatus.SENT) {
        await prisma.estimate.update({
          where: { id: estimate.id },
          data: { status: EstimateStatus.VIEWED, viewedAt: new Date() },
        });
        estimate.status = EstimateStatus.VIEWED;
        estimate.viewedAt = new Date();
      }
      return res.json({ estimate: maskEstimateForCustomer(estimate) });
    }
    if (!hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ estimate });
  } catch (err) {
    next(err);
  }
});

// ----- create / update -----

router.post('/', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const data = createSchema.parse(req.body);

    // Resolve the source — must reference at least one of customer / lead.
    if (!data.customerId && !data.leadId) {
      return res.status(400).json({ error: 'customerId or leadId is required' });
    }

    let templateNameSnapshot: string | null = null;
    let lines = data.lines ?? [];
    if (data.templateId) {
      const tpl = await prisma.estimateTemplate.findUnique({
        where: { id: data.templateId },
        include: { lines: { orderBy: { position: 'asc' } } },
      });
      if (!tpl) return res.status(400).json({ error: 'Template not found' });
      templateNameSnapshot = tpl.name;
      // If caller supplied lines, trust them; otherwise seed from template.
      if (lines.length === 0) {
        lines = tpl.lines.map((l, idx) => ({
          description: l.description,
          quantity: Number(l.defaultQuantity),
          unit: l.unit ?? null,
          unitPriceCents: l.unitPriceCents,
          category: l.category === 'Labor' ? 'Labor' : 'Materials',
          notes: l.notes ?? null,
          position: idx,
        }));
      }
    }

    // Look up the customer/lead's ZIP once so per-line product price
    // resolution stays cheap. Customer.mailingAddress (multi-line freeform)
    // wins over Lead.address (single-line) when both are available.
    let projectZip = '';
    if (data.customerId) {
      const cust = await prisma.user.findUnique({
        where: { id: data.customerId },
        select: { mailingAddress: true },
      });
      projectZip = extractZip(cust?.mailingAddress);
    }
    if (!projectZip && data.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: data.leadId },
        select: { address: true },
      });
      projectZip = extractZip(lead?.address);
    }
    // Resolve every line's seed unit price BEFORE computing totals so the
    // estimate header math agrees with the persisted line rows. The helper
    // is defensive: missing samples / lookup errors fall through to the
    // caller's value, so this never breaks estimate creation.
    const resolvedLines = await Promise.all(
      lines.map(async (l, idx) => {
        const productId = (l as { productId?: string | null }).productId ?? null;
        const unitPriceCents = await resolveLineUnitPrice(
          productId,
          l.unitPriceCents,
          projectZip,
        );
        return { ...l, productId, unitPriceCents, position: l.position ?? idx };
      }),
    );

    const linesWithTotals = resolvedLines.map((l, idx) => ({
      ...l,
      position: l.position ?? idx,
      totalCents: recalcLineTotal(l.quantity, l.unitPriceCents),
    }));
    const overheadBps = data.overheadBps ?? 1000;
    const profitBps = data.profitBps ?? 1000;
    const totals = recalcTotals(
      linesWithTotals,
      data.taxRateBps ?? 0,
      overheadBps,
      profitBps,
    );

    const number = await nextEstimateNumber();
    const estimate = await prisma.estimate.create({
      data: {
        number,
        title: data.title,
        scope: data.scope,
        notes: data.notes,
        termsText: data.termsText,
        taxRateBps: data.taxRateBps ?? 0,
        markupBps: data.markupBps ?? 0,
        overheadBps,
        profitBps,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        customerId: data.customerId ?? null,
        leadId: data.leadId ?? null,
        templateId: data.templateId ?? null,
        templateNameSnapshot,
        createdById: me.id,
        ...totals,
        lines: {
          create: linesWithTotals.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit ?? null,
            unitPriceCents: l.unitPriceCents,
            totalCents: l.totalCents,
            category: l.category === 'Labor' ? 'Labor' : 'Materials',
            notes: l.notes ?? null,
            position: l.position,
            contractorId: l.contractorId ?? null,
            displayTrade: l.displayTrade ?? null,
            action: l.action ?? null,
            // Cast — productId column lands with this change; the deploy
            // script regenerates the Prisma client before the build runs.
            ...((l as { productId?: string | null }).productId
              ? { productId: (l as { productId?: string | null }).productId }
              : {}),
          })) as never,
        },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true } },
        lines: { orderBy: { position: 'asc' } },
      },
    });

    // Carry forward photos from the source lead — sales rep snapped them
    // at the walk-through, no point making them re-upload on the estimate.
    if (data.leadId) {
      const leadPhotos = await prisma.leadAttachment.findMany({
        where: { leadId: data.leadId },
      });
      if (leadPhotos.length > 0) {
        await prisma.estimateAttachment.createMany({
          data: leadPhotos.map((a) => ({
            estimateId: estimate.id,
            uploadedById: a.uploadedById,
            filename: a.filename,
            url: a.url,
            thumbnailUrl: a.thumbnailUrl,
            caption: a.caption,
          })),
        });
      }
    }

    res.status(201).json({ estimate });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const existing = await prisma.estimate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Estimate not found' });

    // Only edit drafts. Already-sent estimates are immutable except for
    // status (handled by /send /accept /decline).
    if (existing.status !== EstimateStatus.DRAFT) {
      return res.status(409).json({ error: 'Only DRAFT estimates can be edited' });
    }
    if (me.role !== Role.ADMIN && existing.createdById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = updateSchema.parse(req.body);

    let totals: ReturnType<typeof recalcTotals> | null = null;
    let lines: Array<{
      description: string; quantity: number; unit: string | null; unitPriceCents: number;
      totalCents: number; category: string; notes: string | null; position: number;
      contractorId: string | null; displayTrade: string | null; action: string | null;
    }> | null = null;

    // Resolve effective O&P: caller's value if supplied, else preserve
    // what's already on the row. This means a PATCH that only changes
    // the title doesn't accidentally zero out O&P.
    const effectiveOverheadBps = data.overheadBps ?? (existing as unknown as { overheadBps?: number }).overheadBps ?? 0;
    const effectiveProfitBps = data.profitBps ?? (existing as unknown as { profitBps?: number }).profitBps ?? 0;
    const effectiveTaxRateBps = data.taxRateBps ?? existing.taxRateBps;

    if (data.lines) {
      lines = data.lines.map((l, idx) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit ?? null,
        unitPriceCents: l.unitPriceCents,
        category: l.category === 'Labor' ? 'Labor' : 'Materials',
        notes: l.notes ?? null,
        position: l.position ?? idx,
        totalCents: recalcLineTotal(l.quantity, l.unitPriceCents),
        contractorId: l.contractorId ?? null,
        displayTrade: l.displayTrade ?? null,
        action: l.action ?? null,
      }));
      totals = recalcTotals(lines, effectiveTaxRateBps, effectiveOverheadBps, effectiveProfitBps);
    } else if (
      data.taxRateBps !== undefined ||
      data.overheadBps !== undefined ||
      data.profitBps !== undefined
    ) {
      // Recompute against existing lines if any of the percentage knobs
      // changed but the lines didn't.
      const cur = await prisma.estimateLine.findMany({ where: { estimateId: existing.id } });
      totals = recalcTotals(cur, effectiveTaxRateBps, effectiveOverheadBps, effectiveProfitBps);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.estimate.update({
        where: { id: existing.id },
        data: {
          title: data.title,
          scope: data.scope,
          notes: data.notes,
          termsText: data.termsText,
          taxRateBps: data.taxRateBps,
          markupBps: data.markupBps,
          overheadBps: data.overheadBps,
          profitBps: data.profitBps,
          validUntil: data.validUntil === null ? null : data.validUntil ? new Date(data.validUntil) : undefined,
          ...(totals ?? {}),
        },
      });
      if (lines) {
        await tx.estimateLine.deleteMany({ where: { estimateId: existing.id } });
        if (lines.length > 0) {
          await tx.estimateLine.createMany({
            data: lines.map((l) => ({
              estimateId: existing.id,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              unitPriceCents: l.unitPriceCents,
              totalCents: l.totalCents,
              category: l.category,
              notes: l.notes,
              position: l.position,
              contractorId: l.contractorId,
              displayTrade: l.displayTrade,
              action: l.action,
            })),
          });
        }
      }
      return tx.estimate.findUnique({
        where: { id: existing.id },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          lead: { select: { id: true, name: true } },
          lines: { orderBy: { position: 'asc' } },
        },
      });
    });
    res.json({ estimate: updated });
  } catch (err) {
    next(err);
  }
});

// ----- send / accept / decline / void -----

router.post('/:id/send', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const existing = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: { customer: { select: { id: true, name: true, email: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Estimate not found' });
    if (existing.status !== EstimateStatus.DRAFT) {
      return res.status(409).json({ error: `Already ${existing.status.toLowerCase()}` });
    }
    if (!existing.customerId) {
      return res
        .status(400)
        .json({ error: 'Estimate must be tied to a customer before sending. Convert the lead or assign a customer first.' });
    }

    const updated = await prisma.estimate.update({
      where: { id: existing.id },
      data: { status: EstimateStatus.SENT, sentAt: new Date() },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    // Reuse the contract invite email — same shape (link to portal page).
    if (updated.customer) {
      sendContractInviteEmail({
        to: updated.customer.email,
        customerName: updated.customer.name,
        contractName: `${updated.title} (estimate ${updated.number})`,
        contractId: `est-${updated.id}`, // not used by the link template
        sentByName: updated.createdBy.name,
      }).catch((err) => console.warn('[estimates] send email failed', err));
    }

    res.json({ estimate: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/accept', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || me.role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only customers can accept' });
    }
    const data = acceptSchema.parse(req.body);
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: { lines: true, customer: true },
    });
    if (!estimate || estimate.customerId !== me.id) {
      return res.status(404).json({ error: 'Estimate not found' });
    }
    const acceptable: EstimateStatus[] = [EstimateStatus.SENT, EstimateStatus.VIEWED];
    if (!acceptable.includes(estimate.status)) {
      return res.status(409).json({ error: `Cannot accept a ${estimate.status.toLowerCase()} estimate` });
    }
    if (estimate.validUntil && estimate.validUntil < new Date()) {
      return res.status(409).json({ error: 'Estimate has expired' });
    }

    // Look for the auto-default contract template. If present we run the
    // full conversion in the same transaction so the customer walks away
    // with a project + draft contract, not just a status change.
    const defaultTemplate = await prisma.contractTemplate.findFirst({
      where: { active: true, isDefaultForEstimateAccept: true },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const e = await tx.estimate.update({
        where: { id: estimate.id },
        data: {
          status: EstimateStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedBySignature: data.signatureName,
          acceptedByIp: req.ip ?? null,
        },
      });
      if (!defaultTemplate || !estimate.customer) return { estimate: e, autoConverted: false };

      // Mirror the staff /convert flow inside the same transaction. Same
      // budget-line seeding (from estimate categories) and same contract
      // body composition; differences are: customer is the actor, project
      // name defaults to the estimate title, and we mark the estimate
      // CONVERTED in this same write.
      const project = await tx.project.create({
        data: {
          name: estimate.title,
          description: estimate.scope ?? undefined,
          customerId: estimate.customer.id,
          status: ProjectStatus.PLANNING,
          budgetCents: estimate.totalCents,
        },
      });
      const grouped = new Map<string | null, number>();
      for (const l of estimate.lines) {
        const key = l.category ?? null;
        grouped.set(key, (grouped.get(key) ?? 0) + l.totalCents);
      }
      for (const [cat, cents] of grouped) {
        if (cents <= 0) continue;
        let categoryId: string | null = null;
        if (cat) {
          const existing = await tx.expenseCategory.findFirst({ where: { name: cat } });
          const row = existing ?? await tx.expenseCategory.create({ data: { name: cat } });
          categoryId = row.id;
        }
        await tx.projectBudgetLine.create({
          data: { projectId: project.id, categoryId, budgetCents: cents, notes: `From estimate ${estimate.number}` },
        });
      }

      const linesText = estimate.lines
        .map((l) => `- ${l.description} (${l.quantity} ${l.unit ?? ''}) — $${(l.totalCents / 100).toFixed(2)}`)
        .join('\n');
      const body = `${defaultTemplate.body}\n\n--- Estimate ${estimate.number}: ${estimate.title} ---\n${linesText}\n\nTotal: $${(estimate.totalCents / 100).toFixed(2)}`;
      const contract = await tx.contract.create({
        data: {
          templateId: defaultTemplate.id,
          templateNameSnapshot: defaultTemplate.name,
          bodySnapshot: body,
          variableValues: {},
          customerId: estimate.customer.id,
          // Use the estimate's createdBy as a stand-in 'author' since the
          // customer can't author contracts. They still see it as a draft.
          createdById: estimate.createdById,
          projectId: project.id,
          status: ContractStatus.DRAFT,
        },
      });

      const final = await tx.estimate.update({
        where: { id: estimate.id },
        data: {
          status: EstimateStatus.CONVERTED,
          convertedProjectId: project.id,
          convertedContractId: contract.id,
        },
        include: {
          convertedProject: { select: { id: true, name: true } },
          convertedContract: { select: { id: true, status: true } },
        },
      });
      return { estimate: final, autoConverted: true, project, contract };
    });

    if (updated.autoConverted) {
      audit(req, {
        action: 'estimate.auto_converted',
        resourceType: 'estimate',
        resourceId: estimate.id,
        meta: {
          projectId: updated.project?.id ?? null,
          contractId: updated.contract?.id ?? null,
          totalCents: estimate.totalCents,
        },
      }).catch(() => undefined);
    }

    res.json({ estimate: updated.estimate, autoConverted: updated.autoConverted });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/decline', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || me.role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only customers can decline' });
    }
    const data = declineSchema.parse(req.body);
    const estimate = await prisma.estimate.findUnique({ where: { id: req.params.id } });
    if (!estimate || estimate.customerId !== me.id) {
      return res.status(404).json({ error: 'Estimate not found' });
    }
    const declinable: EstimateStatus[] = [EstimateStatus.SENT, EstimateStatus.VIEWED];
    if (!declinable.includes(estimate.status)) {
      return res.status(409).json({ error: `Cannot decline a ${estimate.status.toLowerCase()} estimate` });
    }
    const updated = await prisma.estimate.update({
      where: { id: estimate.id },
      data: {
        status: EstimateStatus.DECLINED,
        declinedAt: new Date(),
        declineReason: data.reason,
      },
    });
    res.json({ estimate: updated });
  } catch (err) {
    next(err);
  }
});

const convertSchema = z.object({
  // Optional project scaffolding overrides — defaults derive from estimate.
  projectName: z.string().min(1).max(200).optional(),
  projectAddress: z.string().max(400).optional(),
  // Optional contract template to seed the spawned contract draft from.
  // When absent we still create a placeholder draft contract so the
  // sales rep has a starting point.
  contractTemplateId: z.string().optional(),
});

router.post('/:id/convert', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const data = convertSchema.parse(req.body ?? {});
    const estimate = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: { lines: true, customer: true },
    });
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    if (estimate.status !== EstimateStatus.ACCEPTED) {
      return res.status(409).json({ error: 'Only accepted estimates can be converted' });
    }
    if (estimate.convertedProjectId) {
      return res.status(409).json({ error: 'Already converted' });
    }
    if (!estimate.customerId || !estimate.customer) {
      return res.status(400).json({ error: 'Estimate has no customer to spawn a project for' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: data.projectName ?? estimate.title,
          address: data.projectAddress ?? null,
          description: estimate.scope ?? undefined,
          customerId: estimate.customer!.id,
          status: ProjectStatus.PLANNING,
          budgetCents: estimate.totalCents,
        },
      });

      // Pre-populate per-category budget lines from the estimate so the
      // job-cost rollup has something to compare actuals against. We
      // find-or-create an ExpenseCategory by name for each estimate
      // category so the rollup keys cleanly per category instead of all
      // collapsing under "uncategorised".
      const grouped = new Map<string | null, number>();
      for (const l of estimate.lines) {
        const key = l.category ?? null;
        grouped.set(key, (grouped.get(key) ?? 0) + l.totalCents);
      }
      for (const [cat, cents] of grouped) {
        if (cents <= 0) continue;
        let categoryId: string | null = null;
        if (cat) {
          const existing = await tx.expenseCategory.findFirst({ where: { name: cat } });
          const row = existing
            ? existing
            : await tx.expenseCategory.create({ data: { name: cat } });
          categoryId = row.id;
        }
        await tx.projectBudgetLine.create({
          data: {
            projectId: project.id,
            categoryId,
            budgetCents: cents,
            notes: `From estimate ${estimate.number}`,
          },
        });
      }

      // Spawn a draft contract pre-filled from a template if provided.
      let contractId: string | null = null;
      if (data.contractTemplateId) {
        const tpl = await tx.contractTemplate.findUnique({ where: { id: data.contractTemplateId } });
        if (tpl) {
          const linesText = estimate.lines
            .map((l) => `- ${l.description} (${l.quantity} ${l.unit ?? ''}) — $${(l.totalCents / 100).toFixed(2)}`)
            .join('\n');
          const body = `${tpl.body}\n\n--- Estimate ${estimate.number}: ${estimate.title} ---\n${linesText}\n\nTotal: $${(estimate.totalCents / 100).toFixed(2)}`;
          const c = await tx.contract.create({
            data: {
              templateId: tpl.id,
              templateNameSnapshot: tpl.name,
              bodySnapshot: body,
              variableValues: {},
              customerId: estimate.customer!.id,
              createdById: me.id,
              projectId: project.id,
              status: ContractStatus.DRAFT,
            },
          });
          contractId = c.id;
        }
      }

      // Carry forward any photos from the estimate (which may already
      // include lead photos copied at estimate-create time) into the
      // project's image gallery so the PM has the original visuals.
      const estimatePhotos = await tx.estimateAttachment.findMany({
        where: { estimateId: estimate.id },
      });
      if (estimatePhotos.length > 0) {
        await tx.projectImage.createMany({
          data: estimatePhotos.map((a) => ({
            projectId: project.id,
            uploadedById: a.uploadedById,
            filename: a.filename,
            url: a.url,
            thumbnailUrl: a.thumbnailUrl,
            caption: a.caption,
          })),
        });
      }

      const updatedEstimate = await tx.estimate.update({
        where: { id: estimate.id },
        data: {
          status: EstimateStatus.CONVERTED,
          convertedProjectId: project.id,
          convertedContractId: contractId,
        },
        include: {
          convertedProject: { select: { id: true, name: true } },
          convertedContract: { select: { id: true, status: true } },
        },
      });

      return { estimate: updatedEstimate, project };
    });

    audit(req, {
      action: 'estimate.converted',
      resourceType: 'estimate',
      resourceId: estimate.id,
      meta: { projectId: result.project.id, totalCents: estimate.totalCents },
    }).catch(() => undefined);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Expand an assembly and append its lines to a DRAFT estimate. Returns the
// updated estimate with re-totalled subtotal/tax/total.
router.post('/:id/add-assembly', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const body = z
      .object({ assemblyId: z.string().min(1), quantity: z.number().nonnegative().default(1) })
      .parse(req.body);

    const existing = await prisma.estimate.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!existing) return res.status(404).json({ error: 'Estimate not found' });
    if (existing.status !== EstimateStatus.DRAFT) {
      return res.status(409).json({ error: 'Only DRAFT estimates can be edited' });
    }
    if (me.role !== Role.ADMIN && existing.createdById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let expanded;
    try {
      expanded = await expandAssembly(body.assemblyId, { qtyMultiplier: body.quantity });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Assembly cycle')) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    const startPos = existing.lines.length;
    const newLines = expanded.map((l, idx) => ({
      estimateId: existing.id,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
      totalCents: l.totalCents,
      category: l.category === 'Labor' ? 'Labor' : 'Materials',
      notes: l.notes,
      position: startPos + idx,
    }));

    const allLines = [...existing.lines, ...newLines];
    const existingAny = existing as unknown as { overheadBps?: number; profitBps?: number };
    const totals = recalcTotals(
      allLines.map((l) => ({ totalCents: l.totalCents })),
      existing.taxRateBps,
      existingAny.overheadBps ?? 0,
      existingAny.profitBps ?? 0,
    );

    const updated = await prisma.$transaction(async (tx) => {
      if (newLines.length > 0) {
        await tx.estimateLine.createMany({ data: newLines });
      }
      await tx.estimate.update({ where: { id: existing.id }, data: totals });
      return tx.estimate.findUnique({
        where: { id: existing.id },
        include: {
          lines: { orderBy: { position: 'asc' } },
          customer: { select: { id: true, name: true, email: true } },
        },
      });
    });
    res.json({ estimate: updated, addedLines: newLines.length });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/void', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const existing = await prisma.estimate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Estimate not found' });
    if (existing.status === EstimateStatus.CONVERTED) {
      return res.status(409).json({ error: 'Cannot void a converted estimate' });
    }
    const updated = await prisma.estimate.update({
      where: { id: existing.id },
      data: { status: EstimateStatus.VOID },
    });
    audit(req, {
      action: 'estimate.voided',
      resourceType: 'estimate',
      resourceId: existing.id,
      meta: { previousStatus: existing.status },
    }).catch(() => undefined);
    res.json({ estimate: updated });
  } catch (err) {
    next(err);
  }
});

// ─── Per-line photos ──────────────────────────────────────────────────
//
// Adjuster-style photo attachment on each estimate line. Files land in
// uploads/estimate-lines/<lineId>/<stamp>-<filename>; URLs are returned
// for the client to render thumbnails inline. No sharp pipeline yet —
// raw upload, lines tend to have only a couple of photos each.

const LINE_IMAGE_ROOT = path.resolve(process.cwd(), 'uploads', 'estimate-lines');
const lineImageUpload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(LINE_IMAGE_ROOT, req.params.lineId);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename(_req, file, cb) {
      const stamp = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${stamp}-${safe}`);
    },
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

async function ensureLineEditable(lineId: string, userId: string, isAdmin: boolean) {
  const line = await prisma.estimateLine.findUnique({
    where: { id: lineId },
    include: { estimate: { select: { id: true, createdById: true, status: true } } },
  });
  if (!line) return null;
  if (line.estimate.status !== EstimateStatus.DRAFT) return null;
  if (!isAdmin && line.estimate.createdById !== userId) return null;
  return line;
}

router.get('/:id/lines/:lineId/images', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const line = await prisma.estimateLine.findUnique({
      where: { id: req.params.lineId },
      include: { estimate: { select: { id: true, createdById: true } } },
    });
    if (!line || line.estimateId !== req.params.id) {
      return res.status(404).json({ error: 'Line not found' });
    }
    if (me.role !== Role.ADMIN && line.estimate.createdById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const images = await (prisma as any).estimateLineImage.findMany({
      where: { lineId: line.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ images });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/lines/:lineId/images',
  lineImageUpload.array('files', 8),
  async (req, res, next) => {
    try {
      const me = await loadMe(req.user!.sub);
      if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
      const line = await ensureLineEditable(req.params.lineId, me.id, me.role === Role.ADMIN);
      if (!line || line.estimateId !== req.params.id) {
        return res.status(404).json({ error: 'Line not found or estimate locked' });
      }
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) return res.status(400).json({ error: 'No files received' });
      const caption = typeof req.body.caption === 'string' ? req.body.caption.slice(0, 400) : null;

      const created = await Promise.all(
        files.map((f) =>
          (prisma as any).estimateLineImage.create({
            data: {
              lineId: line.id,
              url: `/uploads/estimate-lines/${line.id}/${f.filename}`,
              caption,
            },
          }),
        ),
      );
      res.status(201).json({ images: created });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:id/lines/:lineId/images/:imageId', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const line = await ensureLineEditable(req.params.lineId, me.id, me.role === Role.ADMIN);
    if (!line || line.estimateId !== req.params.id) {
      return res.status(404).json({ error: 'Line not found or estimate locked' });
    }
    const image = await (prisma as any).estimateLineImage.findUnique({
      where: { id: req.params.imageId },
    });
    if (!image || image.lineId !== line.id) {
      return res.status(404).json({ error: 'Image not found' });
    }
    await (prisma as any).estimateLineImage.delete({ where: { id: image.id } });
    // Best-effort cleanup of the on-disk file.
    if (image.url?.startsWith('/uploads/estimate-lines/')) {
      const filename = path.basename(image.url);
      const filePath = path.join(LINE_IMAGE_ROOT, line.id, filename);
      await fsp.unlink(filePath).catch(() => undefined);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
