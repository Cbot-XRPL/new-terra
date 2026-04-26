import { Router } from 'express';
import { z } from 'zod';
import { ChangeOrderStatus, InvoiceStatus, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { hasSalesAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

// Generate the next CO-YYYY-#### number, monotonic per year.
async function nextChangeOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CO-${year}-`;
  const last = await prisma.changeOrder.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function nextInvoiceNumber(): Promise<string> {
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

async function loadActor(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

// Customer access: only sees change orders on their own projects, and only
// when status is past DRAFT (drafts are internal). Staff with sales access
// see everything; admin always sees everything.
async function canRead(userId: string, role: Role, co: { projectId: string }): Promise<boolean> {
  if (role === Role.ADMIN) return true;
  if (role === Role.CUSTOMER) {
    const project = await prisma.project.findUnique({
      where: { id: co.projectId },
      select: { customerId: true },
    });
    return project?.customerId === userId;
  }
  // staff
  const me = await prisma.user.findUnique({ where: { id: userId } });
  return !!me && hasSalesAccess(me);
}

const createSchema = z.object({
  projectId: z.string().min(1),
  contractId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(4000).nullable().optional(),
  // Signed integer cents. Negative = credit. Optional so customer-initiated
  // requests can omit it (admin quotes the price later).
  amountCents: z.number().int().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const projectId = req.query.projectId as string | undefined;

    const where: { projectId?: string; status?: { not: ChangeOrderStatus } } = {};
    if (projectId) where.projectId = projectId;
    // Customers never see DRAFT change orders (they're internal until SENT).
    if (role === Role.CUSTOMER) where.status = { not: ChangeOrderStatus.DRAFT };

    const all = await prisma.changeOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        project: { select: { id: true, name: true, customerId: true } },
        createdBy: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, status: true } },
      },
    });
    // Filter by readable for customers to avoid leaking other customers' COs.
    const readable: typeof all = [];
    for (const co of all) {
      if (role === Role.CUSTOMER && co.project.customerId !== sub) continue;
      if (role === Role.SUBCONTRACTOR) continue; // subs never see COs
      readable.push(co);
    }
    res.json({ changeOrders: readable });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const co = await prisma.changeOrder.findUnique({
      where: { id: req.params.id },
      include: {
        project: { select: { id: true, name: true, customerId: true } },
        createdBy: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, status: true } },
      },
    });
    if (!co) return res.status(404).json({ error: 'Change order not found' });
    if (!(await canRead(sub, role, co))) {
      return res.status(404).json({ error: 'Change order not found' });
    }
    if (role === Role.CUSTOMER && co.status === ChangeOrderStatus.DRAFT) {
      return res.status(404).json({ error: 'Change order not found' });
    }
    res.json({ changeOrder: co });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const data = createSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: data.projectId } });
    if (!project) return res.status(400).json({ error: 'Project not found' });

    // Customer-initiated requests: only on their own project, status starts
    // as REQUESTED, amountCents defaults to 0 (admin will quote it).
    let status: ChangeOrderStatus;
    let amountCents: number;
    if (me.role === Role.CUSTOMER) {
      if (project.customerId !== me.id) {
        return res.status(403).json({ error: 'Cannot request a change on another customer\'s project' });
      }
      status = ChangeOrderStatus.REQUESTED;
      amountCents = 0;
    } else if (hasSalesAccess(me)) {
      status = ChangeOrderStatus.DRAFT;
      // Staff-authored draft must include an amount.
      if (data.amountCents === undefined) {
        return res.status(400).json({ error: 'amountCents is required when authored by staff' });
      }
      amountCents = data.amountCents;
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (data.contractId) {
      const contract = await prisma.contract.findUnique({ where: { id: data.contractId } });
      if (!contract || contract.projectId !== data.projectId) {
        return res.status(400).json({ error: 'contractId does not belong to this project' });
      }
    }
    const number = await nextChangeOrderNumber();
    const co = await prisma.changeOrder.create({
      data: {
        number,
        projectId: data.projectId,
        contractId: data.contractId ?? null,
        title: data.title,
        description: data.description ?? null,
        amountCents,
        status,
        createdById: me.id,
      },
    });
    audit(req, {
      action: status === ChangeOrderStatus.REQUESTED ? 'changeOrder.requested' : 'changeOrder.created',
      resourceType: 'changeOrder',
      resourceId: co.id,
      meta: { projectId: data.projectId, amountCents, requestedByCustomer: me.role === Role.CUSTOMER },
    }).catch(() => undefined);
    res.status(201).json({ changeOrder: co });
  } catch (err) {
    next(err);
  }
});

// Admin/sales endpoint: take a customer-REQUESTED change order, set the
// price + (optionally) edit description, and flip to DRAFT so the rest of
// the existing flow takes over.
router.post('/:id/quote', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const body = z.object({
      amountCents: z.number().int(),
      description: z.string().max(4000).nullable().optional(),
      title: z.string().min(1).max(160).optional(),
    }).parse(req.body);
    const existing = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (existing.status !== ChangeOrderStatus.REQUESTED) {
      return res.status(409).json({ error: `Can only quote REQUESTED change orders (this is ${existing.status.toLowerCase()})` });
    }
    const updated = await prisma.changeOrder.update({
      where: { id: existing.id },
      data: {
        amountCents: body.amountCents,
        title: body.title,
        description: body.description === null ? null : body.description ?? undefined,
        status: ChangeOrderStatus.DRAFT,
      },
    });
    audit(req, {
      action: 'changeOrder.quoted',
      resourceType: 'changeOrder',
      resourceId: updated.id,
      meta: { amountCents: body.amountCents },
    }).catch(() => undefined);
    res.json({ changeOrder: updated });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(4000).nullable().optional(),
  amountCents: z.number().int().optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const data = patchSchema.parse(req.body);
    const existing = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (existing.status !== ChangeOrderStatus.DRAFT) {
      return res.status(409).json({ error: 'Only DRAFT change orders can be edited' });
    }
    const co = await prisma.changeOrder.update({
      where: { id: existing.id },
      data: { title: data.title, description: data.description ?? undefined, amountCents: data.amountCents },
    });
    res.json({ changeOrder: co });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/send', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const existing = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (existing.status !== ChangeOrderStatus.DRAFT) {
      return res.status(409).json({ error: 'Only DRAFT change orders can be sent' });
    }
    const co = await prisma.changeOrder.update({
      where: { id: existing.id },
      data: { status: ChangeOrderStatus.SENT, sentAt: new Date() },
    });
    audit(req, {
      action: 'changeOrder.sent',
      resourceType: 'changeOrder',
      resourceId: co.id,
    }).catch(() => undefined);
    res.json({ changeOrder: co });
  } catch (err) {
    next(err);
  }
});

const acceptSchema = z.object({ signatureName: z.string().min(1).max(160) });

// Customer accepts a SENT change order. Auto-issues a DRAFT invoice for
// the change amount linked to the same project (positive or negative).
router.post('/:id/accept', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const data = acceptSchema.parse(req.body);
    const existing = await prisma.changeOrder.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { customerId: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (role !== Role.CUSTOMER || existing.project.customerId !== sub) {
      return res.status(403).json({ error: 'Only the customer can accept a change order' });
    }
    if (existing.status !== ChangeOrderStatus.SENT) {
      return res.status(409).json({ error: `Cannot accept a ${existing.status.toLowerCase()} change order` });
    }

    // Capture the signing IP from the proxy header chain (helmet/trust proxy
    // is set in production), falling back to the socket address.
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
      ?? req.socket.remoteAddress
      ?? null;

    // Wrap signature + invoice generation in a transaction so we never end
    // up with a signed CO that has no invoice (or vice versa).
    const updated = await prisma.$transaction(async (tx) => {
      const number = await nextInvoiceNumber();
      const invoice = await tx.invoice.create({
        data: {
          number,
          customerId: existing.project.customerId,
          projectId: existing.projectId,
          amountCents: existing.amountCents,
          status: InvoiceStatus.DRAFT,
          notes: `Change order ${existing.number}: ${existing.title}`,
        },
      });
      return tx.changeOrder.update({
        where: { id: existing.id },
        data: {
          status: ChangeOrderStatus.ACCEPTED,
          signatureName: data.signatureName,
          signatureIp: ip,
          signedAt: new Date(),
          invoiceId: invoice.id,
        },
        include: { invoice: { select: { id: true, number: true, status: true } } },
      });
    });

    audit(req, {
      action: 'changeOrder.accepted',
      resourceType: 'changeOrder',
      resourceId: updated.id,
      meta: { signatureName: data.signatureName, invoiceId: updated.invoiceId },
    }).catch(() => undefined);
    res.json({ changeOrder: updated });
  } catch (err) {
    next(err);
  }
});

const declineSchema = z.object({ reason: z.string().max(2000).nullable().optional() });

router.post('/:id/decline', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const data = declineSchema.parse(req.body);
    const existing = await prisma.changeOrder.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { customerId: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (role !== Role.CUSTOMER || existing.project.customerId !== sub) {
      return res.status(403).json({ error: 'Only the customer can decline a change order' });
    }
    if (existing.status !== ChangeOrderStatus.SENT) {
      return res.status(409).json({ error: `Cannot decline a ${existing.status.toLowerCase()} change order` });
    }
    const co = await prisma.changeOrder.update({
      where: { id: existing.id },
      data: {
        status: ChangeOrderStatus.DECLINED,
        declinedAt: new Date(),
        declineReason: data.reason ?? null,
      },
    });
    res.json({ changeOrder: co });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/void', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const existing = await prisma.changeOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (existing.status === ChangeOrderStatus.ACCEPTED) {
      return res.status(409).json({ error: 'Cannot void an accepted change order' });
    }
    const co = await prisma.changeOrder.update({
      where: { id: existing.id },
      data: { status: ChangeOrderStatus.VOID },
    });
    res.json({ changeOrder: co });
  } catch (err) {
    next(err);
  }
});

export default router;
