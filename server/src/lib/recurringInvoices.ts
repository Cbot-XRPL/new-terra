import { InvoiceStatus, RecurringFrequency } from '@prisma/client';
import { prisma } from '../db.js';

export interface RunResult {
  considered: number;
  generated: number;
  invoiceIds: string[];
  paused: number;
}

// Advance a date by one frequency unit. We do calendar math (not 30-day
// arithmetic) so 'monthly on the 15th' stays on the 15th forever — even
// across February.
export function advanceDate(from: Date, freq: RecurringFrequency, dayOfPeriod: number | null): Date {
  const next = new Date(from);
  switch (freq) {
    case RecurringFrequency.WEEKLY:
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case RecurringFrequency.MONTHLY:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case RecurringFrequency.QUARTERLY:
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case RecurringFrequency.YEARLY:
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
  }
  // Pin day-of-month for the period-based frequencies. Cap at 28 so we never
  // skip a month (Feb 30 doesn't exist; setUTCDate(30) silently rolls over).
  if (dayOfPeriod && dayOfPeriod >= 1 && dayOfPeriod <= 28) {
    next.setUTCDate(dayOfPeriod);
  }
  return next;
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

// Cron entry-point. Picks every active row whose nextRunAt has come due
// and not yet expired, generates a DRAFT invoice from each, and advances
// nextRunAt. Idempotent on the row level: a single run won't double-issue
// because we update nextRunAt + lastRunAt in the same write.
//
// Optional `templateIds` scopes the run to a specific subset of templates,
// used by the per-template "Run now" admin button so a manual trigger
// doesn't accidentally also fire every other due template that happens to
// be ready at the same moment.
export async function runRecurringInvoices(
  now: Date = new Date(),
  opts: { templateIds?: string[] } = {},
): Promise<RunResult> {
  const candidates = await prisma.recurringInvoice.findMany({
    where: {
      active: true,
      nextRunAt: { lte: now },
      ...(opts.templateIds ? { id: { in: opts.templateIds } } : {}),
    },
  });

  const result: RunResult = { considered: candidates.length, generated: 0, invoiceIds: [], paused: 0 };
  for (const tpl of candidates) {
    // If the template's auto-stop date passed, pause and skip.
    if (tpl.endsAt && tpl.endsAt < now) {
      await prisma.recurringInvoice.update({ where: { id: tpl.id }, data: { active: false } });
      result.paused += 1;
      continue;
    }
    try {
      const number = await nextInvoiceNumber();
      const invoice = await prisma.invoice.create({
        data: {
          number,
          customerId: tpl.customerId,
          projectId: tpl.projectId,
          amountCents: tpl.amountCents,
          status: InvoiceStatus.DRAFT,
          notes: tpl.notes ?? `Auto-generated from "${tpl.label}"`,
          lineItems: tpl.lineItems ?? undefined,
        },
      });
      const next = advanceDate(tpl.nextRunAt, tpl.frequency, tpl.dayOfPeriod);
      await prisma.recurringInvoice.update({
        where: { id: tpl.id },
        data: { lastRunAt: now, nextRunAt: next },
      });
      result.generated += 1;
      result.invoiceIds.push(invoice.id);
    } catch (err) {
      console.warn('[recurring] failed for', tpl.id, err);
    }
  }
  return result;
}
