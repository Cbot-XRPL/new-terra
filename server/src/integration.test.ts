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
