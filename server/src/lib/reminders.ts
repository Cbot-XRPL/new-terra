import { ContractStatus, InvoiceStatus, LeadStatus } from '@prisma/client';
import { prisma } from '../db.js';
import {
  sendContractReminderEmail,
  sendInvoiceReminderEmail,
  sendStaleLeadEmail,
} from './mailer.js';
import { computeTotals } from './payments.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface RemindOptions {
  /** Only remind for contracts sent more than this many days ago. */
  staleAfterDays?: number;
  /** Don't re-remind a contract that was reminded within this many days. */
  cooldownDays?: number;
}

export interface RemindResult {
  considered: number;
  reminded: number;
  skippedFresh: number;
  skippedCooldown: number;
}

/**
 * Re-emails customers about contracts that have been sent but not signed,
 * declined, or voided. Throttled so a single contract doesn't get emailed
 * more than once per `cooldownDays` (default 1).
 */
export async function remindStaleContracts(opts: RemindOptions = {}): Promise<RemindResult> {
  const staleAfterDays = opts.staleAfterDays ?? 3;
  const cooldownDays = opts.cooldownDays ?? 1;
  const now = Date.now();
  const staleBefore = new Date(now - staleAfterDays * DAY_MS);
  const cooldownBefore = new Date(now - cooldownDays * DAY_MS);

  const candidates = await prisma.contract.findMany({
    where: {
      status: { in: [ContractStatus.SENT, ContractStatus.VIEWED] },
      sentAt: { lt: staleBefore },
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
    },
  });

  let reminded = 0;
  let skippedFresh = 0;
  let skippedCooldown = 0;
  for (const c of candidates) {
    if (c.lastReminderAt && c.lastReminderAt > cooldownBefore) {
      skippedCooldown += 1;
      continue;
    }
    if (!c.sentAt) {
      // Defensive — sentAt should always exist for SENT/VIEWED.
      skippedFresh += 1;
      continue;
    }
    const daysOpen = Math.max(1, Math.floor((now - c.sentAt.getTime()) / DAY_MS));
    try {
      await sendContractReminderEmail({
        to: c.customer.email,
        customerName: c.customer.name,
        contractName: c.templateNameSnapshot,
        contractId: c.id,
        daysOpen,
      });
      await prisma.contract.update({
        where: { id: c.id },
        data: { lastReminderAt: new Date() },
      });
      reminded += 1;
    } catch (err) {
      console.warn('[reminders] send failed for', c.id, err);
    }
  }

  return {
    considered: candidates.length,
    reminded,
    skippedFresh,
    skippedCooldown,
  };
}

export interface StaleLeadResult {
  considered: number;
  notified: number;
  skippedNoOwner: number;
}

/**
 * Emails the assigned sales rep about leads that have sat in an open
 * status (NEW / CONTACTED / QUALIFIED / QUOTE_SENT) without movement for
 * `staleAfterDays`. Skips ON_HOLD / WON / LOST. The sales-flow widget can
 * also kick this manually.
 *
 * Cooldown is by-lead via updatedAt — once a touch (any update) happens
 * the lead falls out of the stale set until it goes silent again.
 */
export async function notifyStaleLeads(opts: { staleAfterDays?: number } = {}): Promise<StaleLeadResult> {
  const staleAfterDays = opts.staleAfterDays ?? 5;
  const staleBefore = new Date(Date.now() - staleAfterDays * DAY_MS);

  const candidates = await prisma.lead.findMany({
    where: {
      status: {
        in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.QUOTE_SENT],
      },
      updatedAt: { lt: staleBefore },
    },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });

  let notified = 0;
  let skippedNoOwner = 0;
  for (const l of candidates) {
    if (!l.owner) {
      skippedNoOwner += 1;
      continue;
    }
    const daysQuiet = Math.max(1, Math.floor((Date.now() - l.updatedAt.getTime()) / DAY_MS));
    try {
      await sendStaleLeadEmail({
        to: l.owner.email,
        ownerName: l.owner.name,
        leadName: l.name,
        leadId: l.id,
        status: l.status,
        daysQuiet,
      });
      notified += 1;
    } catch (err) {
      console.warn('[reminders] stale-lead email failed for', l.id, err);
    }
  }
  return { considered: candidates.length, notified, skippedNoOwner };
}

export interface InvoiceReminderResult {
  considered: number;
  upcomingReminded: number;
  overdueReminded: number;
  flippedToOverdue: number;
  skippedCooldown: number;
  skippedNoBalance: number;
}

interface InvoiceReminderOptions {
  /** Email customers when an invoice is due in the next N days. Default 3. */
  upcomingWindowDays?: number;
  /** Don't email the same invoice more often than this. Default 3 days. */
  cooldownDays?: number;
}

/**
 * Twin job: bumps SENT invoices to OVERDUE once dueAt passes, and emails
 * customers about either upcoming-due or already-overdue invoices. Same
 * env-var-cron wiring as the other reminders (INVOICE_REMINDER_CRON in the
 * server env). Skips PAID, VOID, DRAFT, anything with zero balance, and
 * anything reminded inside the cooldown window so we don't spam.
 */
export async function remindInvoices(opts: InvoiceReminderOptions = {}): Promise<InvoiceReminderResult> {
  const upcomingWindowDays = opts.upcomingWindowDays ?? 3;
  const cooldownDays = opts.cooldownDays ?? 3;
  const now = new Date();
  const upcomingHorizon = new Date(now.getTime() + upcomingWindowDays * DAY_MS);
  const cooldownBefore = new Date(now.getTime() - cooldownDays * DAY_MS);

  // Auto-flip SENT → OVERDUE for anything past due. We do this in a single
  // updateMany so the email loop below can rely on the status being current.
  const flip = await prisma.invoice.updateMany({
    where: {
      status: InvoiceStatus.SENT,
      dueAt: { lt: now },
    },
    data: { status: InvoiceStatus.OVERDUE },
  });

  // Pull every candidate (SENT in the upcoming window or already OVERDUE)
  // with their payments so we can decide who actually has a balance.
  const candidates = await prisma.invoice.findMany({
    where: {
      OR: [
        { status: InvoiceStatus.SENT, dueAt: { not: null, lte: upcomingHorizon, gte: now } },
        { status: InvoiceStatus.OVERDUE },
      ],
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      payments: { select: { amountCents: true } },
    },
  });

  let upcomingReminded = 0;
  let overdueReminded = 0;
  let skippedCooldown = 0;
  let skippedNoBalance = 0;

  for (const inv of candidates) {
    const totals = computeTotals(inv.amountCents, inv.payments.map((p) => p.amountCents));
    if (totals.balanceCents <= 0) {
      // Edge case: status hasn't been recomputed yet (e.g. payments rows
      // exist but the auto-flip helper hasn't run). Skip without complaint.
      skippedNoBalance += 1;
      continue;
    }
    if (inv.lastReminderAt && inv.lastReminderAt > cooldownBefore) {
      skippedCooldown += 1;
      continue;
    }

    const isOverdue = inv.status === InvoiceStatus.OVERDUE;
    const offsetMs = inv.dueAt ? Math.abs(now.getTime() - inv.dueAt.getTime()) : 0;
    const daysOffset = Math.max(1, Math.floor(offsetMs / DAY_MS));

    try {
      await sendInvoiceReminderEmail({
        to: inv.customer.email,
        customerName: inv.customer.name,
        invoiceNumber: inv.number,
        invoiceId: inv.id,
        amountDueCents: totals.balanceCents,
        dueAt: inv.dueAt,
        kind: isOverdue ? 'overdue' : 'upcoming',
        daysOffset,
        paymentUrl: inv.paymentUrl,
      });
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { lastReminderAt: new Date() },
      });
      if (isOverdue) overdueReminded += 1;
      else upcomingReminded += 1;
    } catch (err) {
      console.warn('[reminders] invoice email failed for', inv.id, err);
    }
  }

  return {
    considered: candidates.length,
    upcomingReminded,
    overdueReminded,
    flippedToOverdue: flip.count,
    skippedCooldown,
    skippedNoBalance,
  };
}
