import { Router } from 'express';
import { z } from 'zod';
import { Role, InvoiceStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { createPaymentLinkForInvoice, isStripeConfigured } from '../lib/stripe.js';
import { ALL_PAYMENT_METHODS, computeTotals, recomputeInvoiceStatus } from '../lib/payments.js';
import { remindInvoices } from '../lib/reminders.js';
import { buildReceiptForPayment } from '../lib/receiptPdf.js';
import { sendPaymentReceiptEmail } from '../lib/mailer.js';

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
  requiresAcknowledgment: z.boolean().optional(),
  milestoneLabel: z.string().max(200).nullable().optional(),
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
        requiresAcknowledgment: data.requiresAcknowledgment,
        milestoneLabel: data.milestoneLabel === null ? null : data.milestoneLabel,
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
  // Whether to auto-email the customer the receipt PDF. Default: true for
  // every method except CASH (cash usually means a hand-off, not a digital
  // workflow) — admin can override either way per-payment.
  emailReceipt: z.boolean().optional(),
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

    // Auto-email the customer the receipt PDF unless the caller explicitly
    // opted out (or it's cash, where the customer just got a hand-off).
    const shouldEmail = body.emailReceipt ?? body.method !== PaymentMethod.CASH;
    let emailed = false;
    if (shouldEmail) {
      try {
        const built = await buildReceiptForPayment(payment.id);
        if (built) {
          await sendPaymentReceiptEmail({
            to: built.payment.customerEmail,
            customerName: built.payment.customerName,
            invoiceNumber: built.payment.invoiceNumber,
            receiptNumber: built.receiptNumber,
            amountCents: built.payment.amountCents,
            method: built.payment.method,
            fullyPaid: built.totals.fullyPaid,
            balanceCents: built.totals.balanceCents,
            pdfBuffer: built.pdf,
          });
          emailed = true;
        }
      } catch (err) {
        // Don't fail the payment record if the email blows up — the row is
        // already written and the admin can resend the receipt manually.
        console.warn('[invoices] receipt email failed for', payment.id, err);
      }
    }

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
        emailed,
      },
    }).catch(() => undefined);

    res.status(201).json({
      payment,
      paidCents: totals.paidCents,
      balanceCents: totals.balanceCents,
      status: totals.status,
      emailed,
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

// Customer acknowledges a milestone on an invoice that requires sign-off
// (typed name + IP capture). Once acknowledged, the front-end stops gating
// the "Pay now" / payment instructions panel for this invoice.
const ackSchema = z.object({ signatureName: z.string().min(1).max(160) });
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    if (role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only the customer can acknowledge a milestone' });
    }
    const data = ackSchema.parse(req.body);
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.customerId !== sub) return res.status(404).json({ error: 'Invoice not found' });
    if (!invoice.requiresAcknowledgment) {
      return res.status(409).json({ error: 'This invoice does not require acknowledgment' });
    }
    if (invoice.acknowledgedAt) {
      return res.status(409).json({ error: 'Already acknowledged' });
    }
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
      ?? req.socket.remoteAddress
      ?? null;
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedName: data.signatureName,
        acknowledgedIp: ip,
      },
    });
    audit(req, {
      action: 'invoice.acknowledged',
      resourceType: 'invoice',
      resourceId: invoice.id,
      meta: { signatureName: data.signatureName, milestoneLabel: invoice.milestoneLabel },
    }).catch(() => undefined);
    res.json({
      invoice: {
        id: updated.id,
        acknowledgedAt: updated.acknowledgedAt,
        acknowledgedName: updated.acknowledgedName,
      },
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

// Streamed PDF receipt for a single payment. Customer can pull receipts on
// their own invoices; staff can pull any. Receipt number is derived from
// the invoice number + payment id suffix so two payments on the same
// invoice get distinct, recognizable receipt numbers.
router.get('/:id/payments/:paymentId/receipt.pdf', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    // Cheap auth check before we render the PDF — confirm the payment exists
    // under this invoice and the customer (if any) owns it.
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.paymentId },
      include: { invoice: { select: { id: true, customerId: true } } },
    });
    if (!payment || payment.invoiceId !== req.params.id) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    if (role === Role.CUSTOMER && payment.invoice.customerId !== sub) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const built = await buildReceiptForPayment(payment.id);
    if (!built) return res.status(404).json({ error: 'Payment not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${built.receiptNumber}.pdf"`);
    res.send(built.pdf);
  } catch (err) {
    next(err);
  }
});

// Manually re-send the receipt email (e.g. customer says they didn't get it).
router.post('/:id/payments/:paymentId/email-receipt', async (req, res, next) => {
  try {
    const me = await loadAccountingActor(req.user!.sub);
    if (!me || (me.role !== Role.ADMIN && !(me.role === Role.EMPLOYEE && me.isAccounting))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.paymentId },
      select: { invoiceId: true },
    });
    if (!payment || payment.invoiceId !== req.params.id) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    const built = await buildReceiptForPayment(req.params.paymentId);
    if (!built) return res.status(404).json({ error: 'Payment not found' });

    await sendPaymentReceiptEmail({
      to: built.payment.customerEmail,
      customerName: built.payment.customerName,
      invoiceNumber: built.payment.invoiceNumber,
      receiptNumber: built.receiptNumber,
      amountCents: built.payment.amountCents,
      method: built.payment.method,
      fullyPaid: built.totals.fullyPaid,
      balanceCents: built.totals.balanceCents,
      pdfBuffer: built.pdf,
    });
    audit(req, {
      action: 'invoice.receipt_emailed',
      resourceType: 'invoice',
      resourceId: req.params.id,
      meta: { paymentId: req.params.paymentId, to: built.payment.customerEmail },
    }).catch(() => undefined);
    res.json({ ok: true, sentTo: built.payment.customerEmail });
  } catch (err) {
    next(err);
  }
});

// Generate a draw schedule for a project: one DRAFT invoice per draw,
// amounts derived from a percent split of the contract value. The last
// draw absorbs any rounding cents so the per-draw amounts always sum
// exactly to the contract value.
const drawSchema = z.object({
  contractValueCents: z.number().int().positive(),
  draws: z
    .array(
      z.object({
        label: z.string().min(1).max(160),
        percent: z.number().positive().max(100),
        // Days offset from project startDate (or now if start is unset).
        // Positive = future. Optional; leave empty for "no due date".
        dueOffsetDays: z.number().int().optional().nullable(),
      }),
    )
    .min(1)
    .max(20),
});

router.post('/_admin/draw-schedule/:projectId', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const body = drawSchema.parse(req.body);
    const totalPercent = body.draws.reduce((s, d) => s + d.percent, 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      return res.status(400).json({ error: `Draws must sum to 100% (got ${totalPercent}%)` });
    }
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId },
      select: { id: true, customerId: true, startDate: true, name: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const baseDate = project.startDate ?? new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    // Pre-compute per-draw amounts. Last draw absorbs the rounding so the
    // sum always lands exactly on contractValueCents — no $0.01 surprises.
    const amounts: number[] = [];
    let runningTotal = 0;
    for (let i = 0; i < body.draws.length - 1; i += 1) {
      const cents = Math.round((body.draws[i].percent / 100) * body.contractValueCents);
      amounts.push(cents);
      runningTotal += cents;
    }
    amounts.push(body.contractValueCents - runningTotal);

    // Issue invoice numbers serially so they sort sensibly.
    const created: Array<{ id: string; number: string; amountCents: number }> = [];
    for (let i = 0; i < body.draws.length; i += 1) {
      const draw = body.draws[i];
      const dueAt = draw.dueOffsetDays != null
        ? new Date(baseDate.getTime() + draw.dueOffsetDays * dayMs)
        : null;
      const number = await nextInvoiceNumber();
      const inv = await prisma.invoice.create({
        data: {
          number,
          customerId: project.customerId,
          projectId: project.id,
          amountCents: amounts[i],
          status: InvoiceStatus.DRAFT,
          dueAt: dueAt ?? undefined,
          notes: `${draw.label} (draw ${i + 1} of ${body.draws.length} — ${draw.percent}% of contract)`,
          // Draws gate "Pay now" behind a customer signoff so they can't pay
          // (and later say they didn't agree the milestone was complete).
          // The deposit (i=0) doesn't require ack — it's signed by virtue
          // of the contract itself.
          requiresAcknowledgment: i > 0,
          milestoneLabel: i > 0 ? draw.label : null,
        },
      });
      created.push({ id: inv.id, number: inv.number, amountCents: inv.amountCents });
    }

    audit(req, {
      action: 'invoice.draw_schedule_generated',
      resourceType: 'project',
      resourceId: project.id,
      meta: {
        contractValueCents: body.contractValueCents,
        drawCount: body.draws.length,
        invoiceIds: created.map((c) => c.id),
      },
    }).catch(() => undefined);

    res.status(201).json({
      project: { id: project.id, name: project.name },
      contractValueCents: body.contractValueCents,
      invoices: created,
    });
  } catch (err) {
    next(err);
  }
});

// Manual run of the invoice reminder cron. Used by admin from the Finance
// dashboard when they want to nudge customers on demand instead of waiting
// for the scheduled job.
router.post('/_admin/run-reminders', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const result = await remindInvoices();
    audit(req, {
      action: 'invoice.reminders_triggered',
      meta: { ...result },
    }).catch(() => undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
