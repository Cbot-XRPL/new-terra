import { ContractStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { sendContractReminderEmail } from './mailer.js';

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
