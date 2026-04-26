import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from './app.js';
import { prisma } from './db.js';
import { hashPassword } from './lib/auth.js';

// End-to-end role-gate sweep against the real express app + database. We seed
// four users with deterministic emails (`it-...@vitest.local`) so reruns and
// the `afterAll` cleanup find them without trampling production data.
//
// To skip this suite (e.g. CI without a DB), set SKIP_INTEGRATION=1.

const skip = process.env.SKIP_INTEGRATION === '1';
const d = skip ? describe.skip : describe;

const app = createApp();

const PASSWORD = 'integ-test-pw-1';

interface Seeded {
  admin: { id: string; email: string; token: string };
  sales: { id: string; email: string; token: string };
  plain: { id: string; email: string; token: string };
  customer: { id: string; email: string; token: string };
}

async function seedUser(opts: {
  email: string;
  name: string;
  role: Role;
  isSales?: boolean;
  isAccounting?: boolean;
  isProjectManager?: boolean;
}) {
  const passwordHash = await hashPassword(PASSWORD);
  return prisma.user.upsert({
    where: { email: opts.email },
    update: {
      name: opts.name,
      role: opts.role,
      passwordHash,
      isSales: opts.isSales ?? false,
      isAccounting: opts.isAccounting ?? false,
      isProjectManager: opts.isProjectManager ?? false,
      isActive: true,
    },
    create: {
      email: opts.email,
      name: opts.name,
      role: opts.role,
      passwordHash,
      isSales: opts.isSales ?? false,
      isAccounting: opts.isAccounting ?? false,
      isProjectManager: opts.isProjectManager ?? false,
      isActive: true,
    },
  });
}

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .set('Content-Type', 'application/json');
  if (res.status !== 200) {
    throw new Error(`login(${email}) → ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

let seeded: Seeded;

beforeAll(async () => {
  if (skip) return;

  const [admin, sales, plain, customer] = await Promise.all([
    seedUser({
      email: 'it-admin@vitest.local',
      name: 'IT Admin',
      role: Role.ADMIN,
    }),
    seedUser({
      email: 'it-sales@vitest.local',
      name: 'IT Sales',
      role: Role.EMPLOYEE,
      isSales: true,
    }),
    seedUser({
      email: 'it-plain@vitest.local',
      name: 'IT Employee',
      role: Role.EMPLOYEE,
    }),
    seedUser({
      email: 'it-customer@vitest.local',
      name: 'IT Customer',
      role: Role.CUSTOMER,
    }),
  ]);

  const [adminTok, salesTok, plainTok, customerTok] = await Promise.all([
    login(admin.email),
    login(sales.email),
    login(plain.email),
    login(customer.email),
  ]);

  seeded = {
    admin: { id: admin.id, email: admin.email, token: adminTok },
    sales: { id: sales.id, email: sales.email, token: salesTok },
    plain: { id: plain.id, email: plain.email, token: plainTok },
    customer: { id: customer.id, email: customer.email, token: customerTok },
  };
}, 30_000);

afterAll(async () => {
  if (skip) return;
  // Best-effort cleanup; ignore failures so a half-broken test doesn't mask the
  // real assertion failure that caused them.
  try {
    await prisma.user.deleteMany({
      where: { email: { in: [
        'it-admin@vitest.local',
        'it-sales@vitest.local',
        'it-plain@vitest.local',
        'it-customer@vitest.local',
      ] } },
    });
  } catch {
    // intentionally swallowed
  }
  await prisma.$disconnect();
});

d('integration · health + auth', () => {
  it('GET /api/health responds 200 without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('rejects login with bad password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: seeded.admin.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me returns the logged-in user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${seeded.admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(seeded.admin.email);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('GET /api/auth/me without a token is 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

d('integration · admin gate', () => {
  it('admin can list users', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${seeded.admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('plain employee gets 403 from /api/admin/users', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${seeded.plain.token}`);
    expect(res.status).toBe(403);
  });

  it('customer gets 403 from /api/admin/users', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${seeded.customer.token}`);
    expect(res.status).toBe(403);
  });
});

d('integration · sales gate', () => {
  it('admin can list catalog assemblies', async () => {
    const res = await request(app)
      .get('/api/catalog/assemblies')
      .set('Authorization', `Bearer ${seeded.admin.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.assemblies)).toBe(true);
  });

  it('sales-flagged employee can list catalog assemblies', async () => {
    const res = await request(app)
      .get('/api/catalog/assemblies')
      .set('Authorization', `Bearer ${seeded.sales.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.assemblies)).toBe(true);
  });

  it('plain employee is 403 on catalog assemblies', async () => {
    const res = await request(app)
      .get('/api/catalog/assemblies')
      .set('Authorization', `Bearer ${seeded.plain.token}`);
    expect(res.status).toBe(403);
  });

  it('customer is 403 on /api/leads', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', `Bearer ${seeded.customer.token}`);
    expect(res.status).toBe(403);
  });
});

d('integration · company settings', () => {
  it('any authenticated user can read settings', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${seeded.customer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.settings).toBeTruthy();
    expect(res.body.settings.id).toBe('default');
  });

  it('only admin can patch settings', async () => {
    const denied = await request(app)
      .patch('/api/settings')
      .set('Authorization', `Bearer ${seeded.sales.token}`)
      .send({ companyName: 'Hax Inc' });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .patch('/api/settings')
      .set('Authorization', `Bearer ${seeded.admin.token}`)
      .send({ companyName: 'IT Test Co', zelleEmail: 'pay@example.com' });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.companyName).toBe('IT Test Co');
    expect(ok.body.settings.zelleEmail).toBe('pay@example.com');
  });

  it('rejects an invalid email', async () => {
    const res = await request(app)
      .patch('/api/settings')
      .set('Authorization', `Bearer ${seeded.admin.token}`)
      .send({ zelleEmail: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

d('integration · receipt PDFs', () => {
  it('admin can fetch a receipt PDF for a recorded payment', async () => {
    const number = `IT-RCPT-${Date.now()}`;
    const invoice = await prisma.invoice.create({
      data: {
        number,
        customerId: seeded.customer.id,
        amountCents: 5_000,
        status: 'SENT',
      },
    });
    try {
      const pay = await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ amountCents: 5_000, method: 'CHECK', referenceNumber: 'CHK-RCPT' });
      expect(pay.status).toBe(201);

      const res = await request(app)
        .get(`/api/invoices/${invoice.id}/payments/${pay.body.payment.id}/receipt.pdf`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      // PDF magic bytes — sanity check we got a real document, not an HTML error.
      expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
    } finally {
      await prisma.invoice.delete({ where: { id: invoice.id } });
    }
  });

  it('a different customer is 404 on someone else\'s receipt', async () => {
    const number = `IT-RCPT2-${Date.now()}`;
    const invoice = await prisma.invoice.create({
      data: {
        number,
        customerId: seeded.customer.id,
        amountCents: 5_000,
        status: 'SENT',
      },
    });
    try {
      const pay = await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ amountCents: 5_000, method: 'CASH' });
      expect(pay.status).toBe(201);

      // Spin up an "other customer" just for this case so the test stays
      // self-contained.
      const other = await seedUser({
        email: 'it-other-customer@vitest.local',
        name: 'Other Customer',
        role: Role.CUSTOMER,
      });
      const otherTok = await login(other.email);
      try {
        const res = await request(app)
          .get(`/api/invoices/${invoice.id}/payments/${pay.body.payment.id}/receipt.pdf`)
          .set('Authorization', `Bearer ${otherTok}`);
        expect(res.status).toBe(404);
      } finally {
        await prisma.user.delete({ where: { id: other.id } });
      }
    } finally {
      await prisma.invoice.delete({ where: { id: invoice.id } });
    }
  });
});

d('integration · payments ledger', () => {
  it('admin records a partial payment, then a final payment, status auto-flips', async () => {
    // Use the seeded customer to own the invoice so cleanup is predictable.
    const number = `IT-${Date.now()}`;
    const invoice = await prisma.invoice.create({
      data: {
        number,
        customerId: seeded.customer.id,
        amountCents: 10_000,
        status: 'SENT',
      },
    });

    try {
      // Partial first.
      const r1 = await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ amountCents: 4_000, method: 'CHECK', referenceNumber: 'CHK-1' });
      expect(r1.status).toBe(201);
      expect(r1.body.balanceCents).toBe(6_000);
      expect(r1.body.status).toBe('SENT');

      // Final remainder flips it.
      const r2 = await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ amountCents: 6_000, method: 'ZELLE', referenceNumber: 'ZL-9' });
      expect(r2.status).toBe(201);
      expect(r2.body.balanceCents).toBe(0);
      expect(r2.body.status).toBe('PAID');

      // Detail reflects both payments + paidAt.
      const detail = await request(app)
        .get(`/api/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.invoice.payments).toHaveLength(2);
      expect(detail.body.invoice.paidAt).toBeTruthy();

      // Delete the second payment → drops back to SENT.
      const lastPaymentId = r2.body.payment.id;
      const del = await request(app)
        .delete(`/api/invoices/${invoice.id}/payments/${lastPaymentId}`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(del.status).toBe(200);
      expect(del.body.status).toBe('SENT');
      expect(del.body.balanceCents).toBe(6_000);
    } finally {
      // Cascade deletes the payments rows too.
      await prisma.invoice.delete({ where: { id: invoice.id } });
    }
  });

  it('plain employee cannot record a payment', async () => {
    const number = `IT-${Date.now() + 1}`;
    const invoice = await prisma.invoice.create({
      data: {
        number,
        customerId: seeded.customer.id,
        amountCents: 5_000,
        status: 'SENT',
      },
    });
    try {
      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/payments`)
        .set('Authorization', `Bearer ${seeded.plain.token}`)
        .send({ amountCents: 1_000, method: 'CASH' });
      expect(res.status).toBe(403);
    } finally {
      await prisma.invoice.delete({ where: { id: invoice.id } });
    }
  });

  it('payment-methods meta endpoint lists all enum values', async () => {
    const res = await request(app)
      .get('/api/invoices/_meta/payment-methods')
      .set('Authorization', `Bearer ${seeded.admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual(
      expect.arrayContaining(['CASH', 'CHECK', 'ZELLE', 'ACH', 'WIRE', 'STRIPE']),
    );
  });
});

d('integration · milestone acknowledgment', () => {
  it('only the customer can acknowledge, and only once', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        number: `IT-ACK-${Date.now()}`,
        customerId: seeded.customer.id,
        amountCents: 5_000,
        status: 'SENT',
        requiresAcknowledgment: true,
        milestoneLabel: 'Test milestone',
      },
    });
    try {
      // Staff blocked.
      const denied = await request(app)
        .post(`/api/invoices/${invoice.id}/acknowledge`)
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ signatureName: 'Hax' });
      expect(denied.status).toBe(403);

      // Customer signs.
      const signed = await request(app)
        .post(`/api/invoices/${invoice.id}/acknowledge`)
        .set('Authorization', `Bearer ${seeded.customer.token}`)
        .send({ signatureName: 'Test Cust' });
      expect(signed.status).toBe(200);
      expect(signed.body.invoice.acknowledgedName).toBe('Test Cust');

      // Second sign blocked.
      const dup = await request(app)
        .post(`/api/invoices/${invoice.id}/acknowledge`)
        .set('Authorization', `Bearer ${seeded.customer.token}`)
        .send({ signatureName: 'Test Cust' });
      expect(dup.status).toBe(409);
    } finally {
      await prisma.invoice.delete({ where: { id: invoice.id } });
    }
  });

  it('rejects ack on an invoice that does not require it', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        number: `IT-ACK2-${Date.now()}`,
        customerId: seeded.customer.id,
        amountCents: 5_000,
        status: 'SENT',
      },
    });
    try {
      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/acknowledge`)
        .set('Authorization', `Bearer ${seeded.customer.token}`)
        .send({ signatureName: 'Cust' });
      expect(res.status).toBe(409);
    } finally {
      await prisma.invoice.delete({ where: { id: invoice.id } });
    }
  });
});

d('integration · change orders', () => {
  it('admin creates → sends → customer accepts → invoice auto-issued', async () => {
    const project = await prisma.project.create({
      data: { name: 'CO Project', customerId: seeded.customer.id, budgetCents: 1000 },
    });
    try {
      const create = await request(app)
        .post('/api/change-orders')
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ projectId: project.id, title: 'Add deck', amountCents: 250_000 });
      expect(create.status).toBe(201);
      const coId = create.body.changeOrder.id;

      // Customer can't see DRAFT change orders.
      const draftPeek = await request(app)
        .get(`/api/change-orders?projectId=${project.id}`)
        .set('Authorization', `Bearer ${seeded.customer.token}`);
      expect(draftPeek.status).toBe(200);
      expect(draftPeek.body.changeOrders).toHaveLength(0);

      const send = await request(app)
        .post(`/api/change-orders/${coId}/send`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(send.status).toBe(200);

      // Now customer sees it.
      const sentPeek = await request(app)
        .get(`/api/change-orders?projectId=${project.id}`)
        .set('Authorization', `Bearer ${seeded.customer.token}`);
      expect(sentPeek.body.changeOrders).toHaveLength(1);

      const accept = await request(app)
        .post(`/api/change-orders/${coId}/accept`)
        .set('Authorization', `Bearer ${seeded.customer.token}`)
        .send({ signatureName: 'Test Customer' });
      expect(accept.status).toBe(200);
      expect(accept.body.changeOrder.status).toBe('ACCEPTED');
      expect(accept.body.changeOrder.invoice).toBeTruthy();

      // Auto-issued invoice exists.
      const invoiceId = accept.body.changeOrder.invoice.id;
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      expect(invoice?.amountCents).toBe(250_000);
      expect(invoice?.status).toBe('DRAFT');
      expect(invoice?.notes).toContain('Change order');
    } finally {
      await prisma.changeOrder.deleteMany({ where: { projectId: project.id } });
      await prisma.invoice.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it('staff cannot accept on the customer\'s behalf', async () => {
    const project = await prisma.project.create({
      data: { name: 'CO Staff Test', customerId: seeded.customer.id, budgetCents: 1000 },
    });
    try {
      const create = await request(app)
        .post('/api/change-orders')
        .set('Authorization', `Bearer ${seeded.admin.token}`)
        .send({ projectId: project.id, title: 'x', amountCents: 100 });
      const coId = create.body.changeOrder.id;
      await request(app)
        .post(`/api/change-orders/${coId}/send`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);

      const res = await request(app)
        .post(`/api/change-orders/${coId}/accept`)
        .set('Authorization', `Bearer ${seeded.sales.token}`)
        .send({ signatureName: 'Hax' });
      expect(res.status).toBe(403);
    } finally {
      await prisma.changeOrder.deleteMany({ where: { projectId: project.id } });
      await prisma.invoice.deleteMany({ where: { projectId: project.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});

d('integration · subcontractor scope', () => {
  it('subcontractor sees only projects they have schedules on', async () => {
    const sub = await seedUser({
      email: 'it-sub@vitest.local',
      name: 'IT Sub',
      role: Role.SUBCONTRACTOR,
    });
    const subTok = await login(sub.email);

    // Two projects: only one has a schedule for this sub.
    const projA = await prisma.project.create({
      data: { name: 'Sub Project A', customerId: seeded.customer.id, budgetCents: 1000 },
    });
    const projB = await prisma.project.create({
      data: { name: 'Sub Project B', customerId: seeded.customer.id, budgetCents: 1000 },
    });
    const sched = await prisma.schedule.create({
      data: {
        projectId: projA.id,
        assigneeId: sub.id,
        title: 'Demo install',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });

    try {
      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', `Bearer ${subTok}`);
      expect(res.status).toBe(200);
      const ids = (res.body.projects as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(projA.id);
      expect(ids).not.toContain(projB.id);

      // Hitting B by id should 404 the sub.
      const detail = await request(app)
        .get(`/api/projects/${projB.id}`)
        .set('Authorization', `Bearer ${subTok}`);
      expect(detail.status).toBe(404);

      // Calendar is scoped to their own schedules even without ?mine=true.
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const cal = await request(app)
        .get(`/api/schedules?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .set('Authorization', `Bearer ${subTok}`);
      expect(cal.status).toBe(200);
      const schedIds = (cal.body.schedules as Array<{ id: string }>).map((s) => s.id);
      expect(schedIds).toEqual([sched.id]);
    } finally {
      await prisma.schedule.delete({ where: { id: sched.id } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: { in: [projA.id, projB.id] } } });
      await prisma.user.delete({ where: { id: sub.id } });
    }
  });
});

d('integration · time tracking is per-user scoped', () => {
  it('plain employee can list their own time entries', async () => {
    const res = await request(app)
      .get('/api/time')
      .set('Authorization', `Bearer ${seeded.plain.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
  });

  it('plain employee is 403 from payroll CSV (accounting-only)', async () => {
    const from = new Date(Date.UTC(2026, 0, 1)).toISOString();
    const to = new Date(Date.UTC(2026, 11, 31, 23, 59, 59)).toISOString();
    const res = await request(app)
      .get(`/api/time/payroll.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${seeded.plain.token}`);
    expect(res.status).toBe(403);
  });

  it('admin can pull payroll CSV', async () => {
    const from = new Date(Date.UTC(2026, 0, 1)).toISOString();
    const to = new Date(Date.UTC(2026, 11, 31, 23, 59, 59)).toISOString();
    const res = await request(app)
      .get(`/api/time/payroll.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${seeded.admin.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    // CSV header row check — keeps the contract stable for the spreadsheet
    // template the accounting team is already working from.
    expect(res.text.split('\n')[0]).toContain('user_id');
  });
});

// ----- Accounting endpoints (P&L, balance sheet, AR/AP, 1099,
// profitability). These read raw rows; we set up specific scenarios
// inline so the assertions can pin exact dollar amounts.

d('integration · accounting · P&L', () => {
  it('counts revenue from payments + bank inflows; expense from expenses + bank outflows', async () => {
    // Project with one $1000 invoice, paid in full this week.
    const project = await prisma.project.create({
      data: { name: 'PL test', customerId: seeded.customer.id, budgetCents: 0 },
    });
    const inv = await prisma.invoice.create({
      data: {
        number: `IT-PL-${Date.now()}`,
        customerId: seeded.customer.id,
        projectId: project.id,
        amountCents: 100_000,
        status: 'PAID',
      },
    });
    const payment = await prisma.payment.create({
      data: {
        invoiceId: inv.id,
        amountCents: 100_000,
        method: 'CHECK',
        receivedAt: new Date(),
      },
    });
    // One categorized expense + one categorized bank-outflow that doesn't
    // match anything — both should land in the expense bucket without
    // double-counting.
    const cat = await prisma.expenseCategory.create({ data: { name: `IT-Cat-${Date.now()}` } });
    const expense = await prisma.expense.create({
      data: {
        amountCents: 25_000,
        date: new Date(),
        description: 'PL test expense',
        categoryId: cat.id,
        projectId: project.id,
      },
    });
    const acct = await prisma.bankAccount.create({
      data: { name: `IT-Acct-${Date.now()}`, kind: 'CHECKING', currentBalanceCents: 0 },
    });
    const bankExpense = await prisma.bankTransaction.create({
      data: {
        accountId: acct.id,
        date: new Date(),
        amountCents: -10_000,
        description: 'PL test bank outflow',
        categoryId: cat.id,
      },
    });
    const bankRevenue = await prisma.bankTransaction.create({
      data: {
        accountId: acct.id,
        date: new Date(),
        amountCents: 5_000,
        description: 'PL test bank inflow',
      },
    });
    try {
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const res = await request(app)
        .get(`/api/finance/pl?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      // Assertions are >= because the test DB may carry rows from earlier
      // groups in this same suite; we want to confirm OUR contributions
      // are reflected, not pin the absolute totals.
      expect(res.body.revenue.invoicePaymentsCents).toBeGreaterThanOrEqual(100_000);
      expect(res.body.revenue.bankInflowsCents).toBeGreaterThanOrEqual(5_000);
      expect(res.body.expense.fromExpensesCents).toBeGreaterThanOrEqual(25_000);
      expect(res.body.expense.fromBankCents).toBeGreaterThanOrEqual(10_000);
      // netIncome = totalRevenue - totalExpense
      const expectedNet = res.body.revenue.totalCents - res.body.expense.totalCents;
      expect(res.body.netIncomeCents).toBe(expectedNet);
    } finally {
      await prisma.bankTransaction.deleteMany({ where: { id: { in: [bankExpense.id, bankRevenue.id] } } });
      await prisma.bankAccount.delete({ where: { id: acct.id } });
      await prisma.expense.delete({ where: { id: expense.id } });
      await prisma.expenseCategory.delete({ where: { id: cat.id } });
      await prisma.payment.delete({ where: { id: payment.id } });
      await prisma.invoice.delete({ where: { id: inv.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });

  it('non-accounting role gets 403', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .get(`/api/finance/pl?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${seeded.plain.token}`);
    expect(res.status).toBe(403);
  });

  it('CSV variant returns text/csv with a Total row', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .get(`/api/finance/pl.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${seeded.admin.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    expect(res.text).toContain('Total revenue');
    expect(res.text).toContain('Net income');
  });
});

d('integration · accounting · balance sheet', () => {
  it('sums cash assets + other assets minus liabilities = equity', async () => {
    const cash = await prisma.bankAccount.create({
      data: { name: `IT-BS-Cash-${Date.now()}`, kind: 'CHECKING', currentBalanceCents: 50_000 },
    });
    const card = await prisma.bankAccount.create({
      data: { name: `IT-BS-Card-${Date.now()}`, kind: 'CREDIT_CARD', currentBalanceCents: 12_000 },
    });
    const asset = await prisma.otherAsset.create({
      data: { name: `IT-BS-Asset-${Date.now()}`, currentValueCents: 100_000 },
    });
    const liab = await prisma.otherLiability.create({
      data: { name: `IT-BS-Liab-${Date.now()}`, currentBalanceCents: 30_000 },
    });
    try {
      const res = await request(app)
        .get('/api/finance/balance-sheet')
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      const totalA = res.body.assets.totalCents;
      const totalL = res.body.liabilities.totalCents;
      expect(totalA - totalL).toBe(res.body.equityCents);
      // Our specific contributions are included.
      const cashIds = res.body.assets.cashAccounts.map((a: { id: string }) => a.id);
      expect(cashIds).toContain(cash.id);
      const cardIds = res.body.liabilities.bankAccounts.map((a: { id: string }) => a.id);
      expect(cardIds).toContain(card.id);
    } finally {
      await prisma.bankAccount.deleteMany({ where: { id: { in: [cash.id, card.id] } } });
      await prisma.otherAsset.delete({ where: { id: asset.id } });
      await prisma.otherLiability.delete({ where: { id: liab.id } });
    }
  });
});

d('integration · accounting · AR aging', () => {
  it('buckets open balances by days past due, drafts separately', async () => {
    const overdue = await prisma.invoice.create({
      data: {
        number: `IT-AR1-${Date.now()}`,
        customerId: seeded.customer.id,
        amountCents: 70_000,
        status: 'OVERDUE',
        issuedAt: new Date(Date.now() - 60 * 86_400_000),
        dueAt: new Date(Date.now() - 45 * 86_400_000),
      },
    });
    const draft = await prisma.invoice.create({
      data: {
        number: `IT-AR2-${Date.now()}`,
        customerId: seeded.customer.id,
        amountCents: 30_000,
        status: 'DRAFT',
      },
    });
    try {
      const res = await request(app)
        .get('/api/finance/ar')
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      // Our $700 overdue lands in the 31–60 bucket.
      const d60 = res.body.buckets.find((b: { key: string }) => b.key === 'd60');
      expect(d60.totalCents).toBeGreaterThanOrEqual(70_000);
      // Drafts are reported separately, not in any aging bucket.
      expect(res.body.drafts.totalCents).toBeGreaterThanOrEqual(30_000);
      expect(res.body.totalOpenBalanceCents).toBeGreaterThanOrEqual(70_000);
    } finally {
      await prisma.invoice.deleteMany({ where: { id: { in: [overdue.id, draft.id] } } });
    }
  });
});

d('integration · accounting · AP aging', () => {
  it('buckets open sub bills by days received', async () => {
    const sub = await seedUser({
      email: `it-ap-sub-${Date.now()}@vitest.local`,
      name: 'IT AP Sub',
      role: Role.SUBCONTRACTOR,
    });
    const oldBill = await prisma.subcontractorBill.create({
      data: {
        number: `IT-AP-${Date.now()}-1`,
        subcontractorId: sub.id,
        amountCents: 50_000,
        status: 'APPROVED',
        receivedAt: new Date(Date.now() - 45 * 86_400_000),
      },
    });
    const newBill = await prisma.subcontractorBill.create({
      data: {
        number: `IT-AP-${Date.now()}-2`,
        subcontractorId: sub.id,
        amountCents: 20_000,
        status: 'PENDING',
        receivedAt: new Date(),
      },
    });
    try {
      const res = await request(app)
        .get('/api/finance/ap')
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      const d60 = res.body.buckets.find((b: { key: string }) => b.key === 'd60');
      const cur = res.body.buckets.find((b: { key: string }) => b.key === 'current');
      expect(d60.totalCents).toBeGreaterThanOrEqual(50_000);
      expect(cur.totalCents).toBeGreaterThanOrEqual(20_000);
      const subRow = res.body.bySub.find((s: { id: string }) => s.id === sub.id);
      expect(subRow.totalCents).toBe(70_000);
    } finally {
      await prisma.subcontractorBill.deleteMany({ where: { id: { in: [oldBill.id, newBill.id] } } });
      await prisma.user.delete({ where: { id: sub.id } });
    }
  });
});

d('integration · accounting · 1099 export', () => {
  it('flags subs over $600 + missing tax info', async () => {
    const subBig = await seedUser({
      email: `it-1099-big-${Date.now()}@vitest.local`,
      name: 'Big Sub',
      role: Role.SUBCONTRACTOR,
    });
    const subSmall = await seedUser({
      email: `it-1099-small-${Date.now()}@vitest.local`,
      name: 'Small Sub',
      role: Role.SUBCONTRACTOR,
    });
    const year = 2023; // any past year so the test data is deterministic
    const paidAt = new Date(Date.UTC(year, 5, 15));
    const big1 = await prisma.subcontractorBill.create({
      data: {
        number: `IT-1099-1-${Date.now()}`,
        subcontractorId: subBig.id,
        amountCents: 80_000, // $800 — over threshold
        status: 'PAID', paidAt,
      },
    });
    const small1 = await prisma.subcontractorBill.create({
      data: {
        number: `IT-1099-2-${Date.now()}`,
        subcontractorId: subSmall.id,
        amountCents: 30_000, // $300 — under
        status: 'PAID', paidAt,
      },
    });
    try {
      const res = await request(app)
        .get(`/api/finance/1099?year=${year}`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      const big = res.body.subs.find((s: { id: string }) => s.id === subBig.id);
      const small = res.body.subs.find((s: { id: string }) => s.id === subSmall.id);
      expect(big.totalCents).toBe(80_000);
      expect(small.totalCents).toBe(30_000);
      // CSV variant flags 'YES' on the big sub since its tax info is missing.
      const csv = await request(app)
        .get(`/api/finance/1099.csv?year=${year}`)
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(csv.status).toBe(200);
      const bigLine = csv.text.split('\n').find((l) => l.includes('Big Sub'));
      expect(bigLine).toBeTruthy();
      // Last two columns are 'Needs 1099' + 'Missing tax info'.
      expect(bigLine).toMatch(/YES,YES$/);
    } finally {
      await prisma.subcontractorBill.deleteMany({ where: { id: { in: [big1.id, small1.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [subBig.id, subSmall.id] } } });
    }
  });
});

d('integration · accounting · profitability', () => {
  it('computes per-project margin from payments minus expenses + labor', async () => {
    const project = await prisma.project.create({
      data: { name: `IT-Prof-${Date.now()}`, customerId: seeded.customer.id, budgetCents: 200_000 },
    });
    const inv = await prisma.invoice.create({
      data: {
        number: `IT-Prof-INV-${Date.now()}`,
        customerId: seeded.customer.id,
        projectId: project.id,
        amountCents: 100_000,
        status: 'PAID',
      },
    });
    const pay = await prisma.payment.create({
      data: { invoiceId: inv.id, amountCents: 100_000, method: 'CHECK', receivedAt: new Date() },
    });
    const expense = await prisma.expense.create({
      data: {
        amountCents: 30_000,
        date: new Date(),
        description: 'Materials',
        projectId: project.id,
      },
    });
    const time = await prisma.timeEntry.create({
      data: {
        userId: seeded.plain.id,
        projectId: project.id,
        startedAt: new Date(Date.now() - 7_200_000),
        endedAt: new Date(),
        minutes: 120,
        hourlyRateCents: 7500,
      },
    });
    try {
      const res = await request(app)
        .get('/api/finance/profitability')
        .set('Authorization', `Bearer ${seeded.admin.token}`);
      expect(res.status).toBe(200);
      const row = res.body.rows.find((r: { projectId: string }) => r.projectId === project.id);
      expect(row.collectedCents).toBe(100_000);
      // expense + labor (2hrs × $75 = $150 = 15000c)
      expect(row.costCents).toBe(30_000 + 15_000);
      expect(row.marginCents).toBe(100_000 - 45_000);
      // 55%
      expect(row.marginPct).toBeCloseTo(55, 0);
    } finally {
      await prisma.timeEntry.delete({ where: { id: time.id } });
      await prisma.expense.delete({ where: { id: expense.id } });
      await prisma.payment.delete({ where: { id: pay.id } });
      await prisma.invoice.delete({ where: { id: inv.id } });
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
