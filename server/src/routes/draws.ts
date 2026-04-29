import { Router } from 'express';
import { z } from 'zod';
import { DrawStatus, InvoiceStatus, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasSalesAccess, hasAccountingAccess } from '../lib/permissions.js';
import { regenerateContractBody } from '../lib/drawSchedule.js';

const router = Router();
router.use(requireAuth);

// Helpers ---------------------------------------------------------------------

function canManageDraws(me: { role: Role; isSales: boolean; isAccounting: boolean; isProjectManager: boolean }) {
  // Sales rep builds the schedule on the contract; PM (or accounting/admin)
  // generates invoices on the project side. Anyone with these caps is
  // allowed to mutate draws.
  if (me.role === Role.ADMIN) return true;
  if (me.role !== Role.EMPLOYEE) return false;
  return me.isSales || me.isAccounting || me.isProjectManager;
}

async function nextInvoiceNumber(): Promise<string> {
  // Mirror of the helper in routes/invoices.ts. Duplicated rather than
  // exported because that file's helper is module-private and pulling it
  // out risks coupling the two files unnecessarily.
  const year = new Date().getFullYear();
  const prefix = `NT-${year}-`;
  const last = await prisma.invoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

// List + read -----------------------------------------------------------------

// Draws on a single contract — used by the contract detail page.
router.get('/contract/:contractId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const contract = await prisma.contract.findUnique({ where: { id: req.params.contractId } });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    // Customer can read draws on their own contract; staff per usual rules.
    const isCustomer = me.role === Role.CUSTOMER && contract.customerId === me.id;
    const isStaff = hasSalesAccess(me) || hasAccountingAccess(me);
    if (!isCustomer && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    const draws = await prisma.draw.findMany({
      where: { contractId: contract.id },
      orderBy: { order: 'asc' },
      include: { invoice: { select: { id: true, number: true, status: true } } },
    });
    res.json({ draws });
  } catch (err) {
    next(err);
  }
});

// Draws on a project — used by the project hub.
router.get('/project/:projectId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    // Customers see draws on their own projects (read-only).
    if (me.role === Role.CUSTOMER && project.customerId !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const draws = await prisma.draw.findMany({
      where: { projectId: project.id },
      orderBy: { order: 'asc' },
      include: { invoice: { select: { id: true, number: true, status: true } } },
    });
    res.json({ draws });
  } catch (err) {
    next(err);
  }
});

// Create / update / delete ----------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  amountCents: z.number().int().nonnegative(),
  percentBasis: z.number().min(0).max(100).optional(),
});

router.post('/contract/:contractId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !canManageDraws(me)) return res.status(403).json({ error: 'Forbidden' });

    const contract = await prisma.contract.findUnique({ where: { id: req.params.contractId } });
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const data = createSchema.parse(req.body);

    // Append at the end of the schedule.
    const last = await prisma.draw.findFirst({
      where: { contractId: contract.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const draw = await prisma.draw.create({
      data: {
        contractId: contract.id,
        projectId: contract.projectId, // mirror at create time; backfill on
                                       // contract→project link too (route below)
        order: (last?.order ?? -1) + 1,
        name: data.name,
        description: data.description,
        amountCents: data.amountCents,
        percentBasis: data.percentBasis,
      },
      include: { invoice: { select: { id: true, number: true, status: true } } },
    });
    await regenerateContractBody(contract.id);
    res.status(201).json({ draw });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
  amountCents: z.number().int().nonnegative().optional(),
  percentBasis: z.number().min(0).max(100).nullable().optional(),
  status: z.nativeEnum(DrawStatus).optional(),
  order: z.number().int().nonnegative().optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !canManageDraws(me)) return res.status(403).json({ error: 'Forbidden' });

    const existing = await prisma.draw.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Draw not found' });
    const data = updateSchema.parse(req.body);

    // Lock fields once we've spawned an invoice — amount/name are baked in.
    if (existing.invoiceId && (data.amountCents !== undefined || data.name !== undefined)) {
      return res
        .status(409)
        .json({ error: 'Cannot edit name or amount after an invoice has been generated for this draw' });
    }

    const draw = await prisma.draw.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        description: data.description === null ? null : data.description,
        amountCents: data.amountCents,
        percentBasis: data.percentBasis === null ? null : data.percentBasis,
        status: data.status,
        order: data.order,
      },
      include: { invoice: { select: { id: true, number: true, status: true } } },
    });
    await regenerateContractBody(existing.contractId);
    res.json({ draw });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !canManageDraws(me)) return res.status(403).json({ error: 'Forbidden' });

    const existing = await prisma.draw.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Draw not found' });
    if (existing.invoiceId) {
      return res
        .status(409)
        .json({ error: 'Cannot delete a draw that has an invoice — void the invoice first' });
    }
    await prisma.draw.delete({ where: { id: existing.id } });
    await regenerateContractBody(existing.contractId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Generate invoice ------------------------------------------------------------

router.post('/:id/generate-invoice', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !canManageDraws(me)) return res.status(403).json({ error: 'Forbidden' });

    const draw = await prisma.draw.findUnique({
      where: { id: req.params.id },
      include: { contract: true },
    });
    if (!draw) return res.status(404).json({ error: 'Draw not found' });
    if (draw.invoiceId) return res.status(409).json({ error: 'This draw already has an invoice' });

    // Resolve the project — the draw mirrors it from the contract at create
    // time, but if the contract got attached to a project after the draw was
    // entered we re-resolve here.
    const projectId = draw.projectId ?? draw.contract.projectId ?? null;
    if (!projectId) {
      return res
        .status(400)
        .json({ error: 'Cannot generate an invoice — the contract has no project attached yet.' });
    }

    const number = await nextInvoiceNumber();
    const milestoneLabel = draw.description
      ? `${draw.name} — ${draw.description.slice(0, 200)}`
      : draw.name;

    const invoice = await prisma.invoice.create({
      data: {
        number,
        customerId: draw.contract.customerId,
        projectId,
        amountCents: draw.amountCents,
        status: InvoiceStatus.DRAFT,
        // Keep the milestone label so the customer sees what they're paying
        // for; the draw schedule is the source of truth.
        milestoneLabel,
        notes: `Draw ${draw.order + 1}: ${draw.name}`,
      },
    });
    const updatedDraw = await prisma.draw.update({
      where: { id: draw.id },
      data: {
        projectId,
        invoiceId: invoice.id,
        status: DrawStatus.INVOICED,
      },
      include: { invoice: { select: { id: true, number: true, status: true } } },
    });
    res.status(201).json({ draw: updatedDraw, invoice });
  } catch (err) {
    next(err);
  }
});

export default router;
