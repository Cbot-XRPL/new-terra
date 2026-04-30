/**
 * One-shot backfill for two retroactive jobs:
 *
 *   1. CUSTOMER lead/estimate linking — for every existing customer,
 *      re-run the lead-link helper that we now run on login/signup.
 *      Catches customers who registered before that auto-link shipped.
 *
 *   2. CONTRACTOR / EMPLOYEE catalog mirror — make sure every active
 *      sub or employee has the auto-managed labor product so the
 *      sales estimator combobox finds them. Catches anyone added
 *      before the auto-product helper shipped.
 *
 * Idempotent — re-running is a no-op once everything is linked /
 * mirrored. Safe to run any time.
 *
 * Usage: `npm --workspace server run db:backfill`
 */

import '../src/env.js';
import { PrismaClient } from '@prisma/client';
import { linkPreviousLeadDataToCustomer } from '../src/lib/leadLinking.js';
import { ensureContractorCatalogItem } from '../src/lib/contractorCatalog.js';

const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.user.findMany({
    where: { role: 'CUSTOMER', isActive: true },
    select: { id: true, email: true, name: true },
  });
  let linkedLeads = 0;
  let linkedEstimates = 0;
  for (const c of customers) {
    const r = await prisma.$transaction((tx) =>
      linkPreviousLeadDataToCustomer(tx, c.email, c.id),
    );
    linkedLeads += r.linkedLeads;
    linkedEstimates += r.linkedEstimates;
    if (r.linkedLeads || r.linkedEstimates) {
      console.log(
        `[backfill] ${c.email} → linked ${r.linkedLeads} lead(s), ${r.linkedEstimates} estimate(s)`,
      );
    }
  }
  console.log(
    `[backfill] customers done — ${customers.length} scanned, ${linkedLeads} leads + ${linkedEstimates} estimates linked`,
  );

  const workers = await prisma.user.findMany({
    where: { role: { in: ['SUBCONTRACTOR', 'EMPLOYEE'] } },
    select: {
      id: true, role: true, name: true, tradeType: true, billingMode: true,
      hourlyRateCents: true, dailyRateCents: true, isActive: true,
    },
  });
  for (const u of workers) {
    await prisma.$transaction((tx) => ensureContractorCatalogItem(tx, u));
  }
  console.log(`[backfill] catalog mirrors done — ${workers.length} sub/employee row(s) processed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
