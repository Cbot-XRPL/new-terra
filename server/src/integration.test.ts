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
