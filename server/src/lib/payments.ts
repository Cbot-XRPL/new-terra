import { InvoiceStatus, PaymentMethod, type PrismaClient } from '@prisma/client';
import { prisma } from '../db.js';

export const ALL_PAYMENT_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.CHECK,
  PaymentMethod.ZELLE,
  PaymentMethod.ACH,
  PaymentMethod.WIRE,
  PaymentMethod.CARD,
  PaymentMethod.STRIPE,
  PaymentMethod.QUICKBOOKS,
  PaymentMethod.OTHER,
];

export interface PaymentTotals {
  paidCents: number;
  balanceCents: number;
  isFullyPaid: boolean;
  isOverpaid: boolean;
}

// Pure function so the API and the Stripe webhook share one definition of
// "fully paid" and the test suite can pin the math without DB access.
export function computeTotals(amountCents: number, paymentsCents: number[]): PaymentTotals {
  const paid = paymentsCents.reduce((s, c) => s + c, 0);
  const balance = amountCents - paid;
  return {
    paidCents: paid,
    balanceCents: balance,
    isFullyPaid: paid >= amountCents && amountCents > 0,
    isOverpaid: paid > amountCents,
  };
}

type Tx = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// Recompute and persist the invoice status from the current payments rows.
// Called after every payment write — keeps status, paidAt, and balance
// consistent without requiring callers to remember the rules.
//
// VOID stays VOID (admin override); everything else flows through:
//   no payments  → SENT (or stays DRAFT if it already is)
//   partial      → SENT
//   fully paid   → PAID + paidAt = max(receivedAt)
export async function recomputeInvoiceStatus(
  invoiceId: string,
  client: Tx = prisma,
): Promise<{ status: InvoiceStatus; paidCents: number; balanceCents: number }> {
  const invoice = await client.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: { select: { amountCents: true, receivedAt: true } } },
  });
  if (!invoice) throw new Error(`recomputeInvoiceStatus: invoice ${invoiceId} not found`);

  const totals = computeTotals(invoice.amountCents, invoice.payments.map((p) => p.amountCents));

  // Hands off voided invoices entirely — admin can un-void by patching status.
  if (invoice.status === InvoiceStatus.VOID) {
    return { status: invoice.status, paidCents: totals.paidCents, balanceCents: totals.balanceCents };
  }

  let nextStatus: InvoiceStatus = invoice.status;
  let nextPaidAt: Date | null | undefined = undefined;

  if (totals.isFullyPaid) {
    nextStatus = InvoiceStatus.PAID;
    // Stamp paidAt at the latest receivedAt so the books reflect when the
    // money actually landed, not when we noticed.
    const latest = invoice.payments
      .map((p) => p.receivedAt.getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    nextPaidAt = latest > 0 ? new Date(latest) : new Date();
  } else if (totals.paidCents > 0 && invoice.status === InvoiceStatus.PAID) {
    // A payment was deleted — drop back to SENT so the invoice doesn't
    // continue claiming PAID with a non-zero balance.
    nextStatus = InvoiceStatus.SENT;
    nextPaidAt = null;
  } else if (totals.paidCents === 0 && invoice.status === InvoiceStatus.PAID) {
    nextStatus = InvoiceStatus.SENT;
    nextPaidAt = null;
  }

  if (nextStatus !== invoice.status || nextPaidAt !== undefined) {
    await client.invoice.update({
      where: { id: invoice.id },
      data: { status: nextStatus, paidAt: nextPaidAt as Date | null | undefined },
    });
  }

  return { status: nextStatus, paidCents: totals.paidCents, balanceCents: totals.balanceCents };
}
