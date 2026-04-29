import { Router } from 'express';
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

function recalcTotals(
  lines: Array<{ totalCents: number }>,
  taxRateBps: number,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
  // taxRateBps of 700 = 7.00% — divide by 10_000.
  const tax = Math.round((subtotal * taxRateBps) / 10_000);
  return { subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
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
    // Customers see this only on their own projects; staff broadly.
    const isCustomer = me.role === Role.CUSTOMER && project.customerId === me.id;
    const isStaff = me.role === Role.ADMIN || me.role === Role.EMPLOYEE;
    if (!isCustomer && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const estimates = await prisma.estimate.findMany({
      where: { convertedProjectId: project.id },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        lines: { orderBy: { position: 'asc' } },
      },
    });
    res.json({ estimates });
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
        lines: { orderBy: { position: 'asc' } },
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
      return res.json({ estimate });
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

    const linesWithTotals = lines.map((l, idx) => ({
      ...l,
      position: l.position ?? idx,
      totalCents: recalcLineTotal(l.quantity, l.unitPriceCents),
    }));
    const totals = recalcTotals(linesWithTotals, data.taxRateBps ?? 0);

    const number = await nextEstimateNumber();
    const estimate = await prisma.estimate.create({
      data: {
        number,
        title: data.title,
        scope: data.scope,
        notes: data.notes,
        termsText: data.termsText,
        taxRateBps: data.taxRateBps ?? 0,
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
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true } },
        lines: { orderBy: { position: 'asc' } },
      },
    });
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

    let totals: { subtotalCents: number; taxCents: number; totalCents: number } | null = null;
    let lines: Array<{
      description: string; quantity: number; unit: string | null; unitPriceCents: number;
      totalCents: number; category: string; notes: string | null; position: number;
    }> | null = null;

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
      }));
      totals = recalcTotals(lines, data.taxRateBps ?? existing.taxRateBps);
    } else if (data.taxRateBps !== undefined) {
      // Re-tax existing lines without rebuilding them.
      const cur = await prisma.estimateLine.findMany({ where: { estimateId: existing.id } });
      totals = recalcTotals(cur, data.taxRateBps);
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
    const totals = recalcTotals(
      allLines.map((l) => ({ totalCents: l.totalCents })),
      existing.taxRateBps,
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

export default router;
