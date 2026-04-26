import { Router } from 'express';
import { z } from 'zod';
import { Role, InvoiceStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { createPaymentLinkForInvoice, isStripeConfigured } from '../lib/stripe.js';
import { ALL_PAYMENT_METHODS, computeTotals, recomputeInvoiceStatus } from '../lib/payments.js';

const router = Router();
router.use(requireAuth);

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().optional(),
  unitCents: z.number().int().nonnegative().optional(),
  totalCents: z.number().int().nonnegative(),
});

const createInvoiceSchema = z.object({
  customerId: z.string().min(1),
  projectId: z.string().nullable().optional(),
  amountCents: z.number().int().nonnegative(),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  paymentUrl: z.string().url().nullable().optional(),
});

const updateInvoiceSchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
  amountCents: z.number().int().nonnegative().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
  lineItems: z.array(lineItemSchema).optional(),
  paidAt: z.string().datetime().nullable().optional(),
  paymentUrl: z.string().url().nullable().optional(),
});

async function nextInvoiceNumber(): Promise<string> {
  // Format: NT-YYYY-#### where #### is monotonic for the year.
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

router.get('/', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const where = role === Role.CUSTOMER ? { customerId: sub } : {};
    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        payments: { select: { amountCents: true } },
      },
    });
    // Decorate with running totals so the list page can show balance/paid
    // without per-row API calls. Drop the raw payments after computing.
    const decorated = invoices.map((inv) => {
      const totals = computeTotals(inv.amountCents, inv.payments.map((p) => p.amountCents));
      const { payments, ...rest } = inv;
      return { ...rest, paidCents: totals.paidCents, balanceCents: totals.balanceCents };
    });
    res.json({ invoices: decorated });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        payments: {
          orderBy: { receivedAt: 'desc' },
          include: { recordedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (role === Role.CUSTOMER && invoice.customerId !== sub) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const totals = computeTotals(
      invoice.amountCents,
      invoice.payments.map((p) => p.amountCents),
    );
    res.json({
      invoice: {
        ...invoice,
        paidCents: totals.paidCents,
        balanceCents: totals.balanceCents,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = createInvoiceSchema.parse(req.body);
    const customer = await prisma.user.findUnique({ where: { id: data.customerId } });
    if (!customer || customer.role !== Role.CUSTOMER) {
      return res.status(400).json({ error: 'customerId must reference a customer' });
    }
    if (data.projectId) {
      const project = await prisma.project.findUnique({ where: { id: data.projectId } });
      if (!project || project.customerId !== data.customerId) {
        return res.status(400).json({ error: 'projectId does not belong to this customer' });
      }
    }
    const number = await nextInvoiceNumber();
    const invoice = await prisma.invoice.create({
      data: {
        number,
        customerId: data.customerId,
        projectId: data.projectId ?? undefined,
        amountCents: data.amountCents,
        dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
        notes: data.notes,
        lineItems: data.lineItems ?? undefined,
        paymentUrl: data.paymentUrl ?? undefined,
        status: InvoiceStatus.DRAFT,
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });
    res.status(201).json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = updateInvoiceSchema.parse(req.body);
    // Auto-stamp paidAt when status flips to PAID and the caller hasn't set it.
    let paidAt = data.paidAt === null ? null : data.paidAt ? new Date(data.paidAt) : undefined;
    if (data.status === InvoiceStatus.PAID && paidAt === undefined) paidAt = new Date();
    if (data.status && data.status !== InvoiceStatus.PAID && paidAt === undefined) paidAt = null;

    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: {
        status: data.status,
        amountCents: data.amountCents,
        dueAt: data.dueAt === null ? null : data.dueAt ? new Date(data.dueAt) : undefined,
        notes: data.notes === null ? null : data.notes,
        lineItems: data.lineItems ?? undefined,
        paymentUrl: data.paymentUrl === null ? null : data.paymentUrl,
        paidAt: paidAt as Date | null | undefined,
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Generate a Stripe Payment Link for this invoice and persist it to
// paymentUrl. The webhook (POST /api/webhooks/stripe) will close the loop
// when payment lands. Stub mode (no STRIPE_SECRET_KEY) returns a synthetic
// URL so the UX is exercisable without real credentials — admin can copy/
// edit it manually.
router.post('/:id/payment-link', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.VOID) {
      return res.status(409).json({ error: `Cannot create a link for a ${invoice.status.toLowerCase()} invoice` });
    }
    const result = await createPaymentLinkForInvoice({
      amountCents: invoice.amountCents,
      description: `Invoice ${invoice.number}`,
      invoiceId: invoice.id,
    });
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { paymentUrl: result.url },
    });
    audit(req, {
      action: 'invoice.payment_link_created',
      resourceType: 'invoice',
      resourceId: invoice.id,
      meta: { stub: result.stub, paymentLinkId: result.paymentLinkId ?? null },
    }).catch(() => undefined);
    res.json({ invoice: updated, stripeConfigured: isStripeConfigured(), stub: result.stub });
  } catch (err) {
    next(err);
  }
});

// ----- Payments ledger -----
//
// Anyone with accounting or admin can record a payment. We don't open this
// up to plain employees so a misclick doesn't accidentally close out an
// invoice; sales staff who need to confirm receipt should ping accounting.

const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.nativeEnum(PaymentMethod),
  referenceNumber: z.string().max(80).optional().nullable(),
  receivedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

async function loadAccountingActor(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isAccounting: true },
  });
}

router.post('/:id/payments', async (req, res, next) => {
  try {
    const me = await loadAccountingActor(req.user!.sub);
    if (!me || (me.role !== Role.ADMIN && !(me.role === Role.EMPLOYEE && me.isAccounting))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const body = recordPaymentSchema.parse(req.body);
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status === InvoiceStatus.VOID) {
      return res.status(409).json({ error: 'Cannot record a payment on a voided invoice' });
    }

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: body.amountCents,
        method: body.method,
        referenceNumber: body.referenceNumber ?? null,
        receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
        notes: body.notes ?? null,
        recordedById: me.id,
      },
      include: { recordedBy: { select: { id: true, name: true } } },
    });

    const totals = await recomputeInvoiceStatus(invoice.id);
    audit(req, {
      action: 'invoice.payment_recorded',
      resourceType: 'invoice',
      resourceId: invoice.id,
      meta: {
        paymentId: payment.id,
        amountCents: payment.amountCents,
        method: payment.method,
        referenceNumber: payment.referenceNumber,
        newStatus: totals.status,
      },
    }).catch(() => undefined);

    res.status(201).json({
      payment,
      paidCents: totals.paidCents,
      balanceCents: totals.balanceCents,
      status: totals.status,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/payments/:paymentId', async (req, res, next) => {
  try {
    const me = await loadAccountingActor(req.user!.sub);
    if (!me || (me.role !== Role.ADMIN && !(me.role === Role.EMPLOYEE && me.isAccounting))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const payment = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
    if (!payment || payment.invoiceId !== req.params.id) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    await prisma.payment.delete({ where: { id: payment.id } });
    const totals = await recomputeInvoiceStatus(payment.invoiceId);
    audit(req, {
      action: 'invoice.payment_deleted',
      resourceType: 'invoice',
      resourceId: payment.invoiceId,
      meta: { paymentId: payment.id, amountCents: payment.amountCents, newStatus: totals.status },
    }).catch(() => undefined);
    res.json({
      ok: true,
      paidCents: totals.paidCents,
      balanceCents: totals.balanceCents,
      status: totals.status,
    });
  } catch (err) {
    next(err);
  }
});

// Surface the available methods for the client dropdown so we don't fork the
// list across the codebase.
router.get('/_meta/payment-methods', (_req, res) => {
  res.json({ methods: ALL_PAYMENT_METHODS });
});

export default router;
