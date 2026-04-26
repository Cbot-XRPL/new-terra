// Demo seed — builds a believable sample portal so admin can do a sales
// walkthrough or smoke-test the UI without typing twenty forms by hand.
// Idempotent within reason: nukes everything except CompanySettings + the
// schema's ExpenseSyncStatus / Role enums and rebuilds. Run with
//   npm run db:seed:demo
// and log in as admin@newterraconstruction.com / changeMe!2026.
//
// Safe-by-default: refuses to run when NODE_ENV=production unless the
// caller passes --force, so a misclick on a prod terminal can't wipe the
// books.

import { PrismaClient, Role, EstimateStatus, InvoiceStatus, PaymentMethod, ProjectStatus, ContractStatus, BankAccountKind } from '@prisma/client';
import { hashPassword } from '../src/lib/auth.js';
import { env } from '../src/env.js';

const prisma = new PrismaClient();

const FORCE = process.argv.includes('--force');

async function main() {
  if (env.nodeEnv === 'production' && !FORCE) {
    console.error('[demo-seed] Refusing to run in production. Pass --force if you really mean it.');
    process.exit(1);
  }

  console.log('[demo-seed] Wiping existing data…');
  // TRUNCATE … CASCADE is dramatically simpler than tracking every FK
  // chain by hand and stays correct as the schema grows. We exclude the
  // _prisma_migrations table so the schema state survives. Spelling out
  // every table name keeps Prisma's own bookkeeping safe.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "BankTransaction", "BankCategorizationRule", "BankAccount",
      "OtherAsset", "OtherLiability",
      "MileageEntry", "PunchListItem", "GalleryShare",
      "SatisfactionSurvey",
      "SubcontractorBillAttachment", "SubcontractorBill",
      "ChangeOrder", "Payment", "RecurringInvoice", "Invoice",
      "InventoryAdjustment", "ProductPriceHistory",
      "EstimateLine", "Estimate", "EstimateTemplateLine", "EstimateTemplate",
      "Contract", "ContractTemplate",
      "ProjectImage", "ProjectDocument", "ProjectComment",
      "TimeEntry", "LogEntry", "Schedule", "Selection",
      "Expense", "ProjectBudgetLine", "Project",
      "LeadActivity", "Lead",
      "Invitation", "MessageBoardPost", "Message",
      "AssemblyLine", "Assembly", "Product",
      "Vendor", "ExpenseCategory",
      "PasswordResetToken", "QbConnection", "AuditEvent",
      "Membership",
      "User", "CompanySettings"
    RESTART IDENTITY CASCADE
  `);

  const pwHash = await hashPassword('changeMe!2026');

  // ----- Users -----
  console.log('[demo-seed] Seeding users…');
  const admin = await prisma.user.create({
    data: { email: env.seedAdmin.email.toLowerCase(), name: env.seedAdmin.name, role: Role.ADMIN, passwordHash: pwHash },
  });
  const sales = await prisma.user.create({
    data: { email: 'sales@demo.local', name: 'Pat Sales', role: Role.EMPLOYEE, isSales: true, passwordHash: pwHash },
  });
  const pm = await prisma.user.create({
    data: { email: 'pm@demo.local', name: 'Jordan PM', role: Role.EMPLOYEE, isProjectManager: true, passwordHash: pwHash },
  });
  const accountant = await prisma.user.create({
    data: { email: 'books@demo.local', name: 'Casey Books', role: Role.EMPLOYEE, isAccounting: true, passwordHash: pwHash },
  });
  const carpenter = await prisma.user.create({
    data: { email: 'carp@demo.local', name: 'Sam Carpenter', role: Role.EMPLOYEE, passwordHash: pwHash },
  });
  const sub = await prisma.user.create({
    data: { email: 'sub@demo.local', name: 'Riley Subs (Plumbing)', role: Role.SUBCONTRACTOR, passwordHash: pwHash, taxId: '12-3456789', mailingAddress: '500 Trade Ln\nAnytown, NY 10001' },
  });
  const c1 = await prisma.user.create({
    data: { email: 'taylor@example.com', name: 'Taylor Homeowner', role: Role.CUSTOMER, passwordHash: pwHash },
  });
  const c2 = await prisma.user.create({
    data: { email: 'morgan@example.com', name: 'Morgan Homeowner', role: Role.CUSTOMER, passwordHash: pwHash },
  });

  // ----- Company settings (overwrite to demo-friendly values) -----
  await prisma.companySettings.upsert({
    where: { id: 'default' },
    update: {
      companyName: 'New Terra Construction',
      phone: '(555) 555-1234',
      email: 'hello@newterraconstruction.com',
      addressLine1: '123 Main St',
      city: 'Anytown', state: 'NY', zip: '10001',
      zelleEmail: 'pay@newterraconstruction.com', zelleName: 'New Terra Construction LLC',
      checkPayableTo: 'New Terra Construction LLC',
      checkMailingAddress: '123 Main St\nAnytown, NY 10001',
      paymentNotes: 'Zelle is fastest. Checks payable to the address above.',
    },
    create: {
      id: 'default',
      companyName: 'New Terra Construction',
      phone: '(555) 555-1234',
      email: 'hello@newterraconstruction.com',
      addressLine1: '123 Main St',
      city: 'Anytown', state: 'NY', zip: '10001',
    },
  });

  // ----- Categories + vendors -----
  console.log('[demo-seed] Seeding categories + vendors…');
  const catMaterials = await prisma.expenseCategory.upsert({
    where: { id: 'cat-materials' }, update: {},
    create: { id: 'cat-materials', name: 'Materials' },
  });
  const catLabor = await prisma.expenseCategory.upsert({
    where: { id: 'cat-labor' }, update: {},
    create: { id: 'cat-labor', name: 'Labor' },
  });
  const catSubs = await prisma.expenseCategory.upsert({
    where: { id: 'cat-subs' }, update: {},
    create: { id: 'cat-subs', name: 'Subcontractors' },
  });
  const catFuel = await prisma.expenseCategory.upsert({
    where: { id: 'cat-fuel' }, update: {},
    create: { id: 'cat-fuel', name: 'Fuel' },
  });
  const homeDepot = await prisma.vendor.create({ data: { name: 'Home Depot' } });
  const lowes = await prisma.vendor.create({ data: { name: "Lowe's" } });

  // ----- Leads -----
  console.log('[demo-seed] Seeding leads…');
  await prisma.lead.create({
    data: {
      name: 'Alex Prospect', email: 'alex@example.com', phone: '555-0102',
      scope: 'Wants a 14x20 deck off the back of a 2-story colonial. Composite, with railing.',
      status: 'QUALIFIED', source: 'WEBSITE_FORM', ownerId: sales.id, createdById: sales.id,
    },
  });
  await prisma.lead.create({
    data: {
      name: 'Sam Tirekick', email: 'sam@example.com', phone: '555-0103',
      scope: 'Kitchen remodel; cabinets + counters + appliance moves.',
      status: 'QUOTE_SENT', source: 'REFERRAL', ownerId: sales.id, createdById: sales.id,
      estimatedValueCents: 4500000,
    },
  });

  // ----- Projects -----
  console.log('[demo-seed] Seeding projects…');
  const proj1 = await prisma.project.create({
    data: {
      name: 'Taylor — backyard deck',
      address: '42 Oakwood Ln, Anytown, NY',
      description: 'Composite deck 16x20 with stairs and gate. Permitted.',
      status: ProjectStatus.ACTIVE,
      customerId: c1.id, projectManagerId: pm.id,
      budgetCents: 2400000,
      laborBudgetCents: 800000,
      startDate: new Date(Date.now() - 21 * 86_400_000),
    },
  });
  const proj2 = await prisma.project.create({
    data: {
      name: 'Morgan — kitchen refresh',
      address: '108 Maple Ct, Anytown, NY',
      description: 'Cabinet swap, quartz tops, new sink + faucet, paint.',
      status: ProjectStatus.PLANNING,
      customerId: c2.id, projectManagerId: pm.id,
      budgetCents: 3800000,
    },
  });

  // Schedule for the sub (so they see proj1 in their list).
  await prisma.schedule.create({
    data: {
      projectId: proj1.id, assigneeId: sub.id,
      title: 'Plumbing rough-in', notes: 'Hose bib relocation',
      startsAt: new Date(Date.now() + 3 * 86_400_000),
      endsAt: new Date(Date.now() + 4 * 86_400_000),
    },
  });

  // Time entries for proj1 (carpenter at $75/hr).
  for (let i = 0; i < 8; i += 1) {
    await prisma.timeEntry.create({
      data: {
        userId: carpenter.id, projectId: proj1.id,
        startedAt: new Date(Date.now() - (20 - i) * 86_400_000),
        endedAt: new Date(Date.now() - (20 - i) * 86_400_000 + 7.5 * 3_600_000),
        minutes: 450, hourlyRateCents: 7500, billable: true,
      },
    });
  }

  // ----- Estimates / contract template -----
  console.log('[demo-seed] Seeding estimates + contracts…');
  const tpl = await prisma.contractTemplate.create({
    data: {
      name: 'Standard build agreement',
      body: 'AGREEMENT BETWEEN NEW TERRA CONSTRUCTION AND {{customer_name}}\n\nProject: {{project_name}}\n\nThe Contractor agrees to perform the work described in the attached estimate at the prices stated. Payment terms: 25% deposit; balance per draw schedule.',
      variables: [],
      isDefaultForEstimateAccept: true,
      createdById: admin.id,
    },
  });
  const est1 = await prisma.estimate.create({
    data: {
      number: 'EST-2026-0001', status: EstimateStatus.ACCEPTED,
      customerId: c1.id, createdById: sales.id,
      title: 'Backyard composite deck', scope: '16x20 composite deck with steps + gate.',
      subtotalCents: 2400000, taxRateBps: 0, taxCents: 0, totalCents: 2400000,
      acceptedAt: new Date(Date.now() - 25 * 86_400_000), acceptedBySignature: 'Taylor Homeowner',
      convertedProjectId: proj1.id, convertedContractId: null,
      lines: {
        create: [
          { description: 'Trex Enhance decking', quantity: 320, unit: 'lf', unitPriceCents: 850, totalCents: 272000, category: 'Materials', position: 0 },
          { description: 'Pressure-treated framing', quantity: 1, unit: 'lump', unitPriceCents: 280000, totalCents: 280000, category: 'Materials', position: 1 },
          { description: 'Carpenter labor', quantity: 80, unit: 'hr', unitPriceCents: 7500, totalCents: 600000, category: 'Labor', position: 2 },
          { description: 'Permits + inspection', quantity: 1, unit: 'lump', unitPriceCents: 50000, totalCents: 50000, category: 'Fees', position: 3 },
          { description: 'Profit + overhead', quantity: 1, unit: 'lump', unitPriceCents: 1198000, totalCents: 1198000, category: 'Fee', position: 4 },
        ],
      },
    },
  });
  // Spawned contract from accept.
  await prisma.contract.create({
    data: {
      templateId: tpl.id,
      templateNameSnapshot: tpl.name,
      bodySnapshot: tpl.body,
      variableValues: {},
      customerId: c1.id, createdById: sales.id, projectId: proj1.id,
      status: ContractStatus.SIGNED,
      sentAt: new Date(Date.now() - 24 * 86_400_000),
      signedAt: new Date(Date.now() - 22 * 86_400_000),
      signatureName: 'Taylor Homeowner',
    },
  });
  void est1;

  // ----- Invoices + payments (deck draw schedule) -----
  console.log('[demo-seed] Seeding invoices + payments…');
  const inv1 = await prisma.invoice.create({
    data: {
      number: 'NT-2026-0001',
      customerId: c1.id, projectId: proj1.id,
      amountCents: 600000, status: InvoiceStatus.PAID,
      issuedAt: new Date(Date.now() - 21 * 86_400_000),
      dueAt: new Date(Date.now() - 14 * 86_400_000),
      paidAt: new Date(Date.now() - 18 * 86_400_000),
      notes: 'Deposit at signing (draw 1 of 4 — 25% of contract)',
    },
  });
  await prisma.payment.create({
    data: {
      invoiceId: inv1.id, amountCents: 600000, method: PaymentMethod.ZELLE,
      referenceNumber: 'ZL-A1B2', receivedAt: new Date(Date.now() - 18 * 86_400_000),
      recordedById: accountant.id,
    },
  });
  const inv2 = await prisma.invoice.create({
    data: {
      number: 'NT-2026-0002',
      customerId: c1.id, projectId: proj1.id,
      amountCents: 600000, status: InvoiceStatus.SENT,
      issuedAt: new Date(Date.now() - 7 * 86_400_000),
      dueAt: new Date(Date.now() + 7 * 86_400_000),
      notes: 'Framing complete (draw 2 of 4 — 25% of contract)',
      requiresAcknowledgment: true, milestoneLabel: 'Framing complete',
    },
  });
  await prisma.invoice.create({
    data: {
      number: 'NT-2026-0003',
      customerId: c1.id, projectId: proj1.id,
      amountCents: 600000, status: InvoiceStatus.DRAFT,
      issuedAt: new Date(),
      notes: 'Mechanical rough-in (draw 3 of 4 — 25% of contract)',
      requiresAcknowledgment: true, milestoneLabel: 'Mechanical rough-in',
    },
  });

  // Overdue invoice on proj2 to populate AR aging.
  await prisma.invoice.create({
    data: {
      number: 'NT-2026-0004',
      customerId: c2.id, projectId: proj2.id,
      amountCents: 100000, status: InvoiceStatus.OVERDUE,
      issuedAt: new Date(Date.now() - 60 * 86_400_000),
      dueAt: new Date(Date.now() - 35 * 86_400_000),
      notes: 'Design retainer',
    },
  });
  void inv2;

  // ----- Expenses -----
  console.log('[demo-seed] Seeding expenses…');
  await prisma.expense.create({
    data: {
      vendorId: homeDepot.id, categoryId: catMaterials.id, projectId: proj1.id,
      amountCents: 247_83, date: new Date(Date.now() - 19 * 86_400_000),
      description: 'Lumber + fasteners', submittedById: pm.id,
    },
  });
  await prisma.expense.create({
    data: {
      vendorId: lowes.id, categoryId: catMaterials.id, projectId: proj1.id,
      amountCents: 89_50, date: new Date(Date.now() - 17 * 86_400_000),
      description: 'Concrete mix + post anchors', submittedById: pm.id,
    },
  });
  await prisma.expense.create({
    data: {
      categoryId: catFuel.id,
      amountCents: 65_00, date: new Date(Date.now() - 12 * 86_400_000),
      description: 'Truck fuel', submittedById: pm.id, paidByUserId: pm.id, reimbursable: true,
    },
  });

  // ----- Mileage -----
  for (let i = 0; i < 6; i += 1) {
    await prisma.mileageEntry.create({
      data: {
        userId: pm.id, projectId: i % 2 === 0 ? proj1.id : null,
        date: new Date(Date.now() - (10 - i) * 86_400_000),
        milesTenths: 240 + i * 30, rateCentsPerMile: 670,
        totalCents: Math.round(((240 + i * 30) * 670) / 10),
        purpose: i % 2 === 0 ? 'Site visit' : 'Supply run',
      },
    });
  }

  // ----- Sub bill -----
  await prisma.subcontractorBill.create({
    data: {
      number: 'SB-2026-0001',
      subcontractorId: sub.id, projectId: proj1.id,
      externalNumber: 'INV-A-7700',
      amountCents: 120000, status: 'PENDING',
      receivedAt: new Date(Date.now() - 3 * 86_400_000),
      notes: 'Hose bib + drain rough-in',
    },
  });

  // ----- Bank account + transactions -----
  console.log('[demo-seed] Seeding bank account…');
  const checking = await prisma.bankAccount.create({
    data: {
      name: 'Demo Checking', kind: BankAccountKind.CHECKING, last4: '4242',
      institutionName: 'Demo Bank', currentBalanceCents: 1_452_17,
    },
  });
  await prisma.bankCategorizationRule.create({
    data: { matchText: 'HOME DEPOT', categoryId: catMaterials.id, vendorId: homeDepot.id },
  });
  await prisma.bankTransaction.create({
    data: {
      accountId: checking.id, date: new Date(Date.now() - 18 * 86_400_000),
      amountCents: 600000, description: 'ZELLE FROM TAYLOR', categoryId: null,
      matchedPaymentId: (await prisma.payment.findFirst())?.id ?? null,
      reconciled: true, reconciledAt: new Date(Date.now() - 17 * 86_400_000),
    },
  });
  await prisma.bankTransaction.create({
    data: {
      accountId: checking.id, date: new Date(Date.now() - 19 * 86_400_000),
      amountCents: -24783, description: 'PURCHASE - HOME DEPOT #1234',
      categoryId: catMaterials.id,
    },
  });

  // ----- Asset / liability for balance sheet -----
  await prisma.otherAsset.create({
    data: { name: '2019 Ford F-150', category: 'Vehicle', currentValueCents: 25_000_00 },
  });
  await prisma.otherLiability.create({
    data: { name: 'Equipment loan — Bobcat', category: 'Loan', currentBalanceCents: 8_000_00 },
  });

  // ----- Punch list on proj1 -----
  await prisma.punchListItem.create({
    data: {
      projectId: proj1.id, description: 'Touch-up paint behind kitchen door',
      area: 'Interior', status: 'READY_FOR_REVIEW', position: 0, createdById: pm.id,
    },
  });
  await prisma.punchListItem.create({
    data: {
      projectId: proj1.id, description: 'Replace squeaky deck step #4',
      area: 'Deck', status: 'OPEN', position: 1, createdById: pm.id,
    },
  });

  void carpenter; void catLabor; void catSubs;

  console.log('\n[demo-seed] ✅ Done. Login:');
  console.log(`  admin       ${admin.email} / changeMe!2026`);
  console.log(`  sales       ${sales.email} / changeMe!2026`);
  console.log(`  PM          ${pm.email} / changeMe!2026`);
  console.log(`  accountant  ${accountant.email} / changeMe!2026`);
  console.log(`  carpenter   ${carpenter.email} / changeMe!2026`);
  console.log(`  sub         ${sub.email} / changeMe!2026`);
  console.log(`  customer 1  ${c1.email} / changeMe!2026`);
  console.log(`  customer 2  ${c2.email} / changeMe!2026`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
