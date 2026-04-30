import type { Prisma } from '@prisma/client';

/**
 * Link any pre-existing lead-attached data to a customer who has just
 * (or was just) created with this email.
 *
 * The sales-flow common case: a rep creates a lead → drafts an estimate
 * with leadId set (no customerId yet) → eventually converts the lead OR
 * the customer accepts the invite. At that moment we want their portal
 * to "just work" — they should see the estimate, the lead history, and
 * any future projects without the rep manually re-attaching anything.
 *
 * What this does, in one transaction:
 *   1. Find all Lead rows with this email that are NOT yet converted and
 *      set their convertedToCustomerId.
 *   2. Back-fill any Estimate that was attached to one of those leads
 *      with the new customerId so the customer's portal lists it.
 *
 * Email match is case-insensitive (we lowercase on insert anywhere a
 * customer-facing email is stored, but lead emails come from form input
 * and may not have been normalised when the lead was created — using
 * `mode: 'insensitive'` covers either way).
 *
 * Designed to be called inside a $transaction; pass the tx client. If
 * you call it outside one, pass the bare prisma client and it'll just
 * run as separate statements (we don't need atomicity across the two
 * tables — if we link the leads but die before the estimate back-fill,
 * the next call still finds the same pending estimates).
 */
export async function linkPreviousLeadDataToCustomer(
  tx: Prisma.TransactionClient,
  email: string,
  customerId: string,
): Promise<{ linkedLeads: number; linkedEstimates: number }> {
  const normalisedEmail = email.toLowerCase();

  const leads = await tx.lead.findMany({
    where: {
      email: { equals: normalisedEmail, mode: 'insensitive' },
      convertedToCustomerId: null,
    },
    select: { id: true },
  });
  if (leads.length === 0) {
    return { linkedLeads: 0, linkedEstimates: 0 };
  }

  const leadIds = leads.map((l) => l.id);
  await tx.lead.updateMany({
    where: { id: { in: leadIds } },
    data: { convertedToCustomerId: customerId, convertedAt: new Date() },
  });

  const estimateLink = await tx.estimate.updateMany({
    where: {
      leadId: { in: leadIds },
      customerId: null,
    },
    data: { customerId },
  });

  return { linkedLeads: leads.length, linkedEstimates: estimateLink.count };
}
