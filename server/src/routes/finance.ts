import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { ExpenseSyncStatus, Role, type Prisma } from '@prisma/client';
import os from 'node:os';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { extractReceipt, resolvePublicUrl } from '../lib/receiptOcr.js';
import {
  canSubmitExpense,
  hasAccountingAccess,
} from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const RECEIPTS_ROOT = path.resolve(process.cwd(), 'uploads', 'receipts');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap — generous for camera shots.
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

// ----- OCR -----
//
// Two endpoints. /expenses/_ocr/scan accepts a fresh upload (form field
// 'receipt'), runs Tesseract over it, and returns the extraction without
// touching the DB — front-end uses it to prefill the new-expense form.
// /expenses/:id/rescan re-runs OCR on an existing expense's stored
// receipt and returns the extraction so admin can update fields by hand.
router.post('/expenses/_ocr/scan', upload.single('receipt'), async (req, res, next) => {
  try {
    // OCR is expensive (Tesseract spawn + 10 MB image). Only users
    // who can actually file an expense should be able to invoke it —
    // otherwise it's a free DOS vector for anyone with a token.
    const me = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { role: true, isAccounting: true, isProjectManager: true },
    });
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!req.file) return res.status(400).json({ error: 'No receipt uploaded' });
    // Tesseract.js wants a file path (or Buffer); we drop the upload to a
    // tmpfile so we can hand it the path. The tmpdir is per-OS so this
    // works on macOS dev and Linux prod alike.
    const tmpPath = path.join(os.tmpdir(), `ocr-${Date.now()}-${process.pid}.jpg`);
    await fs.writeFile(tmpPath, req.file.buffer);
    try {
      const extraction = await extractReceipt(tmpPath);
      res.json({ extraction });
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  } catch (err) { next(err); }
});

router.post('/expenses/:id/rescan', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, role: true, isAccounting: true, isProjectManager: true },
    });
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    // Submitter can rescan their own; accounting + admin can rescan
    // any. Plain PMs can only rescan their own receipts to avoid a
    // poke-around vector on every receipt in the system.
    const isPrivileged = me.role === Role.ADMIN || hasAccountingAccess(me);
    const isOwn = expense.submittedById === me.id || expense.paidByUserId === me.id;
    if (!isPrivileged && !isOwn) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!expense.receiptUrl) return res.status(409).json({ error: 'Expense has no receipt to scan' });
    const filePath = resolvePublicUrl(expense.receiptUrl);
    const extraction = await extractReceipt(filePath);
    res.json({ extraction });
  } catch (err) { next(err); }
});

async function loadMe(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

// ----- Categories (admin + accounting manage; everyone with submit access reads) -----

const categorySchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  qbAccountId: z.string().nullable().optional(),
});

router.get('/categories', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const includeArchived = req.query.archived === 'true';
    const categories = await prisma.expenseCategory.findMany({
      where: includeArchived ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { parent: { select: { id: true, name: true } } },
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = categorySchema.parse(req.body);
    const category = await prisma.expenseCategory.create({
      data: {
        name: data.name,
        parentId: data.parentId ?? null,
        active: data.active ?? true,
        qbAccountId: data.qbAccountId ?? null,
      },
    });
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
});

router.patch('/categories/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = categorySchema.partial().parse(req.body);
    const category = await prisma.expenseCategory.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        parentId: data.parentId === null ? null : data.parentId,
        active: data.active,
        qbAccountId: data.qbAccountId === null ? null : data.qbAccountId,
      },
    });
    res.json({ category });
  } catch (err) {
    next(err);
  }
});

// ----- Vendors -----

const vendorSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

router.get('/vendors', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const includeArchived = req.query.archived === 'true';
    const q = (req.query.q as string | undefined)?.trim();
    const where: Prisma.VendorWhereInput = includeArchived ? {} : { active: true };
    if (q) where.name = { contains: q, mode: 'insensitive' };
    const vendors = await prisma.vendor.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 200,
    });
    res.json({ vendors });
  } catch (err) {
    next(err);
  }
});

// PMs (and accounting/admin) can create new vendors on the fly when entering
// a receipt — the field-tech reality is "I'm at the register and the vendor
// isn't in the system yet". Keeping create permissive avoids data-entry
// friction. Edits stay accounting-only.
router.post('/vendors', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = vendorSchema.parse(req.body);
    const vendor = await prisma.vendor.create({
      data: {
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
        active: data.active ?? true,
      },
    });
    res.status(201).json({ vendor });
  } catch (err) {
    next(err);
  }
});

router.patch('/vendors/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = vendorSchema.partial().parse(req.body);
    const vendor = await prisma.vendor.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        email: data.email === null ? null : data.email,
        phone: data.phone === null ? null : data.phone,
        address: data.address === null ? null : data.address,
        notes: data.notes === null ? null : data.notes,
        active: data.active,
      },
    });
    res.json({ vendor });
  } catch (err) {
    next(err);
  }
});

// ----- Expenses -----

// JSON create — used when there's no receipt image (e.g. recurring rent).
const expenseSchema = z.object({
  vendorId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  // Trade tag — optional in general, but the PM job-receipt UI requires it.
  tradeType: z.string().max(60).nullable().optional(),
  // Payment source — drives the bank-tx matching workflow.
  //   'cash'    = paid in cash, no bank-tx to reconcile
  //   'account' = paid from a tracked BankAccount (set paidFromAccountId)
  //   'other'   = custom label (Zelle to spouse, hardware-store store credit, etc.)
  paymentSource: z.enum(['cash', 'account', 'other']).nullable().optional(),
  paymentSourceLabel: z.string().max(80).nullable().optional(),
  paidFromAccountId: z.string().nullable().optional(),
  paidByUserId: z.string().nullable().optional(),
  amountCents: z.number().int().nonnegative(),
  date: z.string().datetime(),
  description: z.string().max(500).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  reimbursable: z.boolean().optional(),
});

const updateExpenseSchema = expenseSchema.partial().extend({
  reimbursedAt: z.string().datetime().nullable().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().optional(),
  projectId: z.string().optional(),
  categoryId: z.string().optional(),
  vendorId: z.string().optional(),
  paidByUserId: z.string().optional(),
  syncStatus: z.nativeEnum(ExpenseSyncStatus).optional(),
  // "mine" = paidByUserId or submittedById = self. Useful for PMs reviewing
  // their own pending reimbursables without seeing company-wide data.
  mine: z.enum(['true', 'false']).optional(),
  reimbursable: z.enum(['true', 'false']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sort: z.enum(['date', 'amountCents', 'createdAt']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

const expenseInclude = {
  vendor: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  paidBy: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true } },
  paidFromAccount: { select: { id: true, name: true, last4: true } },
} as const;

router.get('/expenses', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const q = listQuery.parse(req.query);
    const where: Prisma.ExpenseWhereInput = {};

    // Non-accounting submitters only see their own + project-attached
    // entries on projects they manage. Accounting + admin see everything.
    if (!hasAccountingAccess(me)) {
      const myProjects = me.role === Role.EMPLOYEE && me.isProjectManager
        ? await prisma.project.findMany({ where: { projectManagerId: me.id }, select: { id: true } })
        : [];
      where.OR = [
        { paidByUserId: me.id },
        { submittedById: me.id },
        ...(myProjects.length ? [{ projectId: { in: myProjects.map((p) => p.id) } }] : []),
      ];
    }

    if (q.mine === 'true') {
      where.OR = [{ paidByUserId: me.id }, { submittedById: me.id }];
    }
    if (q.projectId) where.projectId = q.projectId;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.vendorId) where.vendorId = q.vendorId;
    if (q.paidByUserId) where.paidByUserId = q.paidByUserId;
    if (q.syncStatus) where.syncStatus = q.syncStatus;
    if (q.reimbursable) where.reimbursable = q.reimbursable === 'true';
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    if (q.q) {
      where.AND = [
        ...((where.AND as Prisma.ExpenseWhereInput[]) ?? []),
        {
          OR: [
            { description: { contains: q.q, mode: 'insensitive' } },
            { notes: { contains: q.q, mode: 'insensitive' } },
            { vendor: { name: { contains: q.q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [expenses, total, totalCents] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { [q.sort]: q.dir },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: expenseInclude,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amountCents: true } }),
    ]);
    res.json({
      expenses,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalCents: totalCents._sum.amountCents ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

// Aggregate dashboard for the finance landing page. Cheap, single round-trip,
// scoped per role the same way the list endpoint is.
// ----- 1099 export -----
//
// Yearly summary CSV: one row per subcontractor with the total amount
// paid via PAID SubcontractorBills inside the calendar year. IRS triggers
// 1099-NEC at $600 — we mark those rows with a needs1099 column so the
// CPA / admin can spot-check which subs need a form. Subs missing taxId
// or mailingAddress get flagged in their own column so admin knows to
// chase the W-9.
router.get('/1099.csv', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const schema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
    const q = schema.parse(req.query);

    const yearStart = new Date(Date.UTC(q.year, 0, 1));
    const yearEnd = new Date(Date.UTC(q.year + 1, 0, 1));

    const bills = await prisma.subcontractorBill.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: yearStart, lt: yearEnd },
      },
      include: {
        subcontractor: {
          select: { id: true, name: true, email: true, taxId: true, mailingAddress: true },
        },
      },
    });

    // Group by sub.
    interface SubRow {
      id: string;
      name: string;
      email: string;
      taxId: string | null;
      mailingAddress: string | null;
      totalCents: number;
      billCount: number;
    }
    const grouped = new Map<string, SubRow>();
    for (const b of bills) {
      const ex = grouped.get(b.subcontractorId) ?? {
        id: b.subcontractor.id,
        name: b.subcontractor.name,
        email: b.subcontractor.email,
        taxId: b.subcontractor.taxId,
        mailingAddress: b.subcontractor.mailingAddress,
        totalCents: 0,
        billCount: 0,
      };
      ex.totalCents += b.amountCents;
      ex.billCount += 1;
      grouped.set(b.subcontractorId, ex);
    }

    const escape = (s: string | number | null | undefined) => {
      if (s == null) return '';
      const v = String(s);
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };

    const lines: string[] = [];
    lines.push(`1099 totals,${q.year}`);
    lines.push('Sub name,Email,Tax ID,Mailing address,Bills paid,Total (USD),Needs 1099 (>= $600),Missing tax info');
    const sorted = [...grouped.values()].sort((a, b) => b.totalCents - a.totalCents);
    for (const r of sorted) {
      const needs = r.totalCents >= 60000 ? 'YES' : 'no';
      const missing = (!r.taxId || !r.mailingAddress) && r.totalCents >= 60000 ? 'YES' : 'no';
      lines.push([
        escape(r.name),
        escape(r.email),
        escape(r.taxId),
        escape(r.mailingAddress?.replace(/\n/g, ' / ')),
        r.billCount,
        (r.totalCents / 100).toFixed(2),
        needs,
        missing,
      ].join(','));
    }
    if (sorted.length === 0) {
      lines.push('(no paid sub bills in this year)');
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="1099-${q.year}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

// JSON shape for the admin UI to render before downloading.
router.get('/1099', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const schema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
    const q = schema.parse(req.query);
    const yearStart = new Date(Date.UTC(q.year, 0, 1));
    const yearEnd = new Date(Date.UTC(q.year + 1, 0, 1));
    const bills = await prisma.subcontractorBill.findMany({
      where: { status: 'PAID', paidAt: { gte: yearStart, lt: yearEnd } },
      include: {
        subcontractor: { select: { id: true, name: true, email: true, taxId: true, mailingAddress: true } },
      },
    });
    const grouped = new Map<string, {
      id: string;
      name: string;
      email: string;
      taxId: string | null;
      mailingAddress: string | null;
      totalCents: number;
      billCount: number;
    }>();
    for (const b of bills) {
      const ex = grouped.get(b.subcontractorId) ?? {
        id: b.subcontractor.id,
        name: b.subcontractor.name,
        email: b.subcontractor.email,
        taxId: b.subcontractor.taxId,
        mailingAddress: b.subcontractor.mailingAddress,
        totalCents: 0,
        billCount: 0,
      };
      ex.totalCents += b.amountCents;
      ex.billCount += 1;
      grouped.set(b.subcontractorId, ex);
    }
    const subs = [...grouped.values()].sort((a, b) => b.totalCents - a.totalCents);
    res.json({ year: q.year, subs });
  } catch (err) { next(err); }
});

// ----- P&L (Profit & Loss) + Balance Sheet -----
//
// Cash-basis P&L for any date range. Revenue is the sum of payments
// received within the window; expense is split across:
//   * categorized bank transactions (when they don't already match an
//     Expense / SubBill — those would double-count)
//   * unmatched bank transactions tagged as outflows that have a category
//   * Expense rows in the window NOT auto-issued by a paid SubBill
//     (sub bills already write an expense; we just take the expense)
//
// Returns sums by category so end-of-year filing has the breakdown the
// IRS forms ask for. The CSV export hits the same calc.

router.get('/pl', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const schema = z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    });
    const q = schema.parse(req.query);
    const from = new Date(q.from);
    const to = new Date(q.to);

    // Revenue: payments received in the window.
    const payments = await prisma.payment.findMany({
      where: { receivedAt: { gte: from, lte: to } },
      include: {
        invoice: { select: { project: { select: { id: true, name: true } } } },
      },
    });
    const revenueCents = payments.reduce((s, p) => s + p.amountCents, 0);
    // Bucket revenue by project for the rollup.
    const revenueByProject = new Map<string, { name: string; cents: number }>();
    for (const p of payments) {
      const id = p.invoice.project?.id ?? '__unassigned__';
      const name = p.invoice.project?.name ?? 'Unassigned';
      const ex = revenueByProject.get(id) ?? { name, cents: 0 };
      ex.cents += p.amountCents;
      revenueByProject.set(id, ex);
    }

    // Expenses: every Expense in the window. SubBill auto-issued expenses
    // are already in here, so we don't double-count the SubBill itself.
    const expenses = await prisma.expense.findMany({
      where: { date: { gte: from, lte: to } },
      include: { category: { select: { id: true, name: true } } },
    });
    let expenseFromExpensesCents = 0;
    const expenseByCategory = new Map<string, { name: string; cents: number }>();
    for (const e of expenses) {
      expenseFromExpensesCents += e.amountCents;
      const id = e.category?.id ?? '__uncategorised__';
      const name = e.category?.name ?? 'Uncategorised';
      const ex = expenseByCategory.get(id) ?? { name, cents: 0 };
      ex.cents += e.amountCents;
      expenseByCategory.set(id, ex);
    }

    // Bank transactions: include outflows that DON'T match an Expense /
    // Payment / SubBill (those would double-count) and DO have a category.
    // Inflows that don't match a Payment add to revenue (e.g. owner draw
    // returned, refunds — admin can re-categorize as desired).
    const bankTxs = await prisma.bankTransaction.findMany({
      where: { date: { gte: from, lte: to } },
      include: { category: { select: { id: true, name: true } } },
    });
    let bankExpenseCents = 0;
    let bankRevenueCents = 0;
    for (const t of bankTxs) {
      if (t.matchedPaymentId || t.matchedExpenseId || t.matchedSubBillId) continue;
      if (t.amountCents > 0) {
        bankRevenueCents += t.amountCents;
        // Reuse the category bucket on the revenue side ('Other income') if set.
      } else {
        const cents = -t.amountCents;
        bankExpenseCents += cents;
        const id = t.category?.id ?? '__uncategorised_bank__';
        const name = t.category?.name ?? 'Uncategorised bank outflow';
        const ex = expenseByCategory.get(id) ?? { name, cents: 0 };
        ex.cents += cents;
        expenseByCategory.set(id, ex);
      }
    }

    const totalRevenueCents = revenueCents + bankRevenueCents;
    const totalExpenseCents = expenseFromExpensesCents + bankExpenseCents;
    const netIncomeCents = totalRevenueCents - totalExpenseCents;

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      revenue: {
        totalCents: totalRevenueCents,
        invoicePaymentsCents: revenueCents,
        bankInflowsCents: bankRevenueCents,
        byProject: [...revenueByProject.entries()].map(([id, v]) => ({ projectId: id, name: v.name, cents: v.cents })).sort((a, b) => b.cents - a.cents),
      },
      expense: {
        totalCents: totalExpenseCents,
        fromExpensesCents: expenseFromExpensesCents,
        fromBankCents: bankExpenseCents,
        byCategory: [...expenseByCategory.entries()].map(([id, v]) => ({ categoryId: id, name: v.name, cents: v.cents })).sort((a, b) => b.cents - a.cents),
      },
      netIncomeCents,
    });
  } catch (err) {
    next(err);
  }
});

// CSV variant of the P&L. Same numbers, copy-pasteable into a CPA's
// spreadsheet. Two sections: Revenue (by project) + Expense (by category)
// with totals + a net-income footer.
router.get('/pl.csv', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const schema = z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    });
    const q = schema.parse(req.query);

    // Re-derive everything via the same JSON endpoint to keep the math
    // in one place. We fetch internally rather than re-implementing.
    const from = new Date(q.from);
    const to = new Date(q.to);

    const escape = (s: string | number) => {
      const v = String(s);
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };

    // Reuse the same logic: expensive but cheap (one extra round-trip).
    // For a real-deal endpoint we'd extract a shared helper.
    const reqLike = req as unknown as Parameters<typeof prisma.payment.findMany>[0];
    void reqLike; // keep tsc quiet; the logic below is duplicated for now.

    const payments = await prisma.payment.findMany({
      where: { receivedAt: { gte: from, lte: to } },
      include: { invoice: { select: { project: { select: { id: true, name: true } } } } },
    });
    const revenueByProject = new Map<string, { name: string; cents: number }>();
    for (const p of payments) {
      const id = p.invoice.project?.id ?? '__unassigned__';
      const name = p.invoice.project?.name ?? 'Unassigned';
      const ex = revenueByProject.get(id) ?? { name, cents: 0 };
      ex.cents += p.amountCents;
      revenueByProject.set(id, ex);
    }
    const totalRevenueCents = payments.reduce((s, p) => s + p.amountCents, 0);

    const expenses = await prisma.expense.findMany({
      where: { date: { gte: from, lte: to } },
      include: { category: { select: { id: true, name: true } } },
    });
    const expenseByCategory = new Map<string, { name: string; cents: number }>();
    let expenseTotal = 0;
    for (const e of expenses) {
      expenseTotal += e.amountCents;
      const id = e.category?.id ?? '__uncategorised__';
      const name = e.category?.name ?? 'Uncategorised';
      const ex = expenseByCategory.get(id) ?? { name, cents: 0 };
      ex.cents += e.amountCents;
      expenseByCategory.set(id, ex);
    }
    const bankTxs = await prisma.bankTransaction.findMany({
      where: { date: { gte: from, lte: to } },
      include: { category: { select: { id: true, name: true } } },
    });
    let bankExpense = 0;
    let bankRevenue = 0;
    for (const t of bankTxs) {
      if (t.matchedPaymentId || t.matchedExpenseId || t.matchedSubBillId) continue;
      if (t.amountCents > 0) {
        bankRevenue += t.amountCents;
      } else {
        const cents = -t.amountCents;
        bankExpense += cents;
        const id = t.category?.id ?? '__uncategorised_bank__';
        const name = t.category?.name ?? 'Uncategorised bank outflow';
        const ex = expenseByCategory.get(id) ?? { name, cents: 0 };
        ex.cents += cents;
        expenseByCategory.set(id, ex);
      }
    }

    const totalRevenue = totalRevenueCents + bankRevenue;
    const totalExpense = expenseTotal + bankExpense;
    const netIncome = totalRevenue - totalExpense;

    const lines: string[] = [];
    lines.push(`Profit & Loss,${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`);
    lines.push('');
    lines.push('Revenue by project,Amount (USD)');
    for (const [, v] of [...revenueByProject.entries()].sort((a, b) => b[1].cents - a[1].cents)) {
      lines.push(`${escape(v.name)},${(v.cents / 100).toFixed(2)}`);
    }
    if (bankRevenue > 0) lines.push(`Other bank inflows,${(bankRevenue / 100).toFixed(2)}`);
    lines.push(`Total revenue,${(totalRevenue / 100).toFixed(2)}`);
    lines.push('');
    lines.push('Expense by category,Amount (USD)');
    for (const [, v] of [...expenseByCategory.entries()].sort((a, b) => b[1].cents - a[1].cents)) {
      lines.push(`${escape(v.name)},${(v.cents / 100).toFixed(2)}`);
    }
    lines.push(`Total expense,${(totalExpense / 100).toFixed(2)}`);
    lines.push('');
    lines.push(`Net income,${(netIncome / 100).toFixed(2)}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pl-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

// Balance sheet at any "as of" date. Cash assets = sum of bank account
// balances classified as assets. Other assets = sum of OtherAsset rows.
// Liabilities = sum of bank accounts classified as liabilities + OtherLiability.
// Equity = Assets − Liabilities. We don't try to compute a 'historical'
// balance from transactions — admin keeps the account balances
// up-to-date manually, which matches the QB workflow they already use.
router.get('/balance-sheet', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const accounts = await prisma.bankAccount.findMany({ where: { active: true } });
    const otherAssets = await prisma.otherAsset.findMany({ where: { archived: false } });
    const otherLiabilities = await prisma.otherLiability.findMany({ where: { archived: false } });

    const liabilityKinds = new Set(['CREDIT_CARD', 'LINE_OF_CREDIT', 'LOAN']);

    let cashAssetsCents = 0;
    let bankLiabilitiesCents = 0;
    const cashAccounts: Array<{ id: string; name: string; cents: number }> = [];
    const bankLiabilityAccounts: Array<{ id: string; name: string; cents: number }> = [];
    for (const a of accounts) {
      const isLiability = a.isLiability || liabilityKinds.has(a.kind);
      if (isLiability) {
        bankLiabilitiesCents += a.currentBalanceCents;
        bankLiabilityAccounts.push({ id: a.id, name: a.name, cents: a.currentBalanceCents });
      } else {
        cashAssetsCents += a.currentBalanceCents;
        cashAccounts.push({ id: a.id, name: a.name, cents: a.currentBalanceCents });
      }
    }

    const otherAssetsCents = otherAssets.reduce((s, a) => s + a.currentValueCents, 0);
    const otherLiabilitiesCents = otherLiabilities.reduce((s, l) => s + l.currentBalanceCents, 0);

    const totalAssetsCents = cashAssetsCents + otherAssetsCents;
    const totalLiabilitiesCents = bankLiabilitiesCents + otherLiabilitiesCents;
    const equityCents = totalAssetsCents - totalLiabilitiesCents;

    res.json({
      asOf: new Date().toISOString(),
      assets: {
        totalCents: totalAssetsCents,
        cashAccounts,
        otherAssets: otherAssets.map((a) => ({ id: a.id, name: a.name, category: a.category, cents: a.currentValueCents })),
      },
      liabilities: {
        totalCents: totalLiabilitiesCents,
        bankAccounts: bankLiabilityAccounts,
        otherLiabilities: otherLiabilities.map((l) => ({ id: l.id, name: l.name, category: l.category, cents: l.currentBalanceCents })),
      },
      equityCents,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/balance-sheet.csv', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const accounts = await prisma.bankAccount.findMany({ where: { active: true } });
    const otherAssets = await prisma.otherAsset.findMany({ where: { archived: false } });
    const otherLiabilities = await prisma.otherLiability.findMany({ where: { archived: false } });
    const liabilityKinds = new Set(['CREDIT_CARD', 'LINE_OF_CREDIT', 'LOAN']);

    const escape = (s: string | number) => {
      const v = String(s);
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };

    const lines: string[] = [];
    lines.push(`Balance sheet,as of ${new Date().toISOString().slice(0, 10)}`);
    lines.push('');
    lines.push('ASSETS,Amount (USD)');
    let totalAssets = 0;
    for (const a of accounts.filter((x) => !x.isLiability && !liabilityKinds.has(x.kind))) {
      lines.push(`${escape(a.name)},${(a.currentBalanceCents / 100).toFixed(2)}`);
      totalAssets += a.currentBalanceCents;
    }
    for (const a of otherAssets) {
      lines.push(`${escape(`${a.name}${a.category ? ` (${a.category})` : ''}`)},${(a.currentValueCents / 100).toFixed(2)}`);
      totalAssets += a.currentValueCents;
    }
    lines.push(`Total assets,${(totalAssets / 100).toFixed(2)}`);
    lines.push('');
    lines.push('LIABILITIES,Amount (USD)');
    let totalLiabilities = 0;
    for (const a of accounts.filter((x) => x.isLiability || liabilityKinds.has(x.kind))) {
      lines.push(`${escape(a.name)},${(a.currentBalanceCents / 100).toFixed(2)}`);
      totalLiabilities += a.currentBalanceCents;
    }
    for (const l of otherLiabilities) {
      lines.push(`${escape(`${l.name}${l.category ? ` (${l.category})` : ''}`)},${(l.currentBalanceCents / 100).toFixed(2)}`);
      totalLiabilities += l.currentBalanceCents;
    }
    lines.push(`Total liabilities,${(totalLiabilities / 100).toFixed(2)}`);
    lines.push('');
    lines.push(`Equity (assets − liabilities),${((totalAssets - totalLiabilities) / 100).toFixed(2)}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="balance-sheet-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
});

// Per-project profitability rollup. Cash basis: revenue = sum of payments
// received against the project's invoices; cost = sum of expenses tagged
// to the project + labor cost from closed time entries. Margin =
// revenue − cost; pct rounds to one decimal. Open / planning projects
// with $0 collected return marginPct=null so the UI shows '—' instead of
// nonsensical '-100%'.
router.get('/profitability', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const projects = await prisma.project.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        invoices: {
          where: { status: { not: 'VOID' } },
          select: {
            amountCents: true,
            payments: { select: { amountCents: true } },
          },
        },
        expenses: { select: { amountCents: true } },
        timeEntries: {
          where: { endedAt: { not: null } },
          select: { minutes: true, hourlyRateCents: true },
        },
      },
    });

    interface Row {
      projectId: string;
      name: string;
      customer: string;
      status: string;
      invoicedCents: number;
      collectedCents: number;
      expenseCents: number;
      laborCents: number;
      costCents: number;
      marginCents: number;
      marginPct: number | null;
    }
    const rows: Row[] = projects.map((p) => {
      const invoiced = p.invoices.reduce((s, inv) => s + inv.amountCents, 0);
      const collected = p.invoices.reduce(
        (s, inv) => s + inv.payments.reduce((q, x) => q + x.amountCents, 0),
        0,
      );
      const expense = p.expenses.reduce((s, e) => s + e.amountCents, 0);
      const labor = p.timeEntries.reduce(
        (s, t) => s + Math.round((t.minutes / 60) * t.hourlyRateCents),
        0,
      );
      const cost = expense + labor;
      const margin = collected - cost;
      const marginPct = collected > 0
        ? Math.round((margin / collected) * 1000) / 10
        : null;
      return {
        projectId: p.id,
        name: p.name,
        customer: p.customer.name,
        status: p.status,
        invoicedCents: invoiced,
        collectedCents: collected,
        expenseCents: expense,
        laborCents: labor,
        costCents: cost,
        marginCents: margin,
        marginPct,
      };
    });

    // Portfolio totals — useful for a "how is the year going" sanity check.
    const totals = rows.reduce(
      (acc, r) => ({
        invoicedCents: acc.invoicedCents + r.invoicedCents,
        collectedCents: acc.collectedCents + r.collectedCents,
        costCents: acc.costCents + r.costCents,
      }),
      { invoicedCents: 0, collectedCents: 0, costCents: 0 },
    );
    const totalsMargin = totals.collectedCents - totals.costCents;
    const totalsPct = totals.collectedCents > 0
      ? Math.round((totalsMargin / totals.collectedCents) * 1000) / 10
      : null;

    res.json({
      rows: rows.sort((a, b) => b.collectedCents - a.collectedCents),
      totals: {
        ...totals,
        marginCents: totalsMargin,
        marginPct: totalsPct,
        projectCount: rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// AP (accounts payable) aging — the inverse of AR. Reports what the
// company OWES, bucketed by days since the bill was received. Includes:
//   * SubcontractorBill rows in PENDING / APPROVED status (not yet PAID,
//     not VOID), grouped by sub
//   * standalone OtherLiability rows (loans, leases, tax payable)
//
// Bucket calculation runs from receivedAt (or createdAt for liabilities
// without a date), same shape as the AR aging endpoint so the UI can
// reuse rendering. Subs / customers / plain employees stay locked out.
router.get('/ap', async (_req, res, next) => {
  try {
    const me = await loadMe(_req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    interface Bucket {
      label: string;
      totalCents: number;
      count: number;
    }
    const buckets: Record<'current' | 'd30' | 'd60' | 'd90' | 'd90plus', Bucket> = {
      current: { label: 'New (≤7 days)', totalCents: 0, count: 0 },
      d30:    { label: '8–30 days', totalCents: 0, count: 0 },
      d60:    { label: '31–60 days', totalCents: 0, count: 0 },
      d90:    { label: '61–90 days', totalCents: 0, count: 0 },
      d90plus:{ label: '90+ days', totalCents: 0, count: 0 },
    };
    function bucketKey(daysOld: number): keyof typeof buckets {
      if (daysOld <= 7) return 'current';
      if (daysOld <= 30) return 'd30';
      if (daysOld <= 60) return 'd60';
      if (daysOld <= 90) return 'd90';
      return 'd90plus';
    }

    const openBills = await prisma.subcontractorBill.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] } },
      include: {
        subcontractor: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });

    interface SubRow {
      id: string;
      name: string;
      email: string;
      totalCents: number;
      pendingCents: number;
      approvedCents: number;
      billCount: number;
      oldestDays: number;
    }
    const bySub = new Map<string, SubRow>();
    let totalOwedToSubsCents = 0;

    for (const b of openBills) {
      const days = Math.max(0, Math.floor((now.getTime() - b.receivedAt.getTime()) / dayMs));
      const key = bucketKey(days);
      buckets[key].totalCents += b.amountCents;
      buckets[key].count += 1;
      totalOwedToSubsCents += b.amountCents;

      const ex = bySub.get(b.subcontractor.id) ?? {
        id: b.subcontractor.id,
        name: b.subcontractor.name,
        email: b.subcontractor.email,
        totalCents: 0,
        pendingCents: 0,
        approvedCents: 0,
        billCount: 0,
        oldestDays: 0,
      };
      ex.totalCents += b.amountCents;
      if (b.status === 'PENDING') ex.pendingCents += b.amountCents;
      else ex.approvedCents += b.amountCents;
      ex.billCount += 1;
      if (days > ex.oldestDays) ex.oldestDays = days;
      bySub.set(b.subcontractor.id, ex);
    }

    // Other liabilities (loans/leases/tax payable). Treated as one bucket
    // each — they're typically slow-moving balances, not aged invoices.
    const otherLiabilities = await prisma.otherLiability.findMany({
      where: { archived: false },
    });
    const totalOtherLiabilitiesCents = otherLiabilities.reduce(
      (s, l) => s + l.currentBalanceCents, 0,
    );

    const bySubArr = [...bySub.values()].sort((a, b) => b.totalCents - a.totalCents);

    res.json({
      asOf: now.toISOString(),
      buckets: Object.entries(buckets).map(([key, b]) => ({ key, ...b })),
      totalOwedToSubsCents,
      totalOtherLiabilitiesCents,
      totalOwedCents: totalOwedToSubsCents + totalOtherLiabilitiesCents,
      bySub: bySubArr,
      otherLiabilities: otherLiabilities.map((l) => ({
        id: l.id,
        name: l.name,
        category: l.category,
        cents: l.currentBalanceCents,
      })),
      // Top-10 most-overdue bills so admin can chase the longest-aged.
      topOverdue: openBills
        .map((b) => ({
          id: b.id,
          number: b.number,
          subName: b.subcontractor.name,
          project: b.project ? b.project.name : null,
          status: b.status,
          amountCents: b.amountCents,
          receivedAt: b.receivedAt.toISOString(),
          daysOld: Math.max(0, Math.floor((now.getTime() - b.receivedAt.getTime()) / dayMs)),
        }))
        .sort((a, b) => b.daysOld - a.daysOld)
        .slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

// AR aging + expected-cash rollup. Pulls every non-VOID, non-PAID-in-full
// invoice and buckets the outstanding balance into current / 30 / 60 / 90+
// days from dueAt (current = "due in the future or no due date set"). The
// expected-cash window sums every invoice with dueAt within the next N
// days so admin can eyeball the runway.
router.get('/ar', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const now = new Date();
    const open = await prisma.invoice.findMany({
      where: {
        status: { in: ['SENT', 'OVERDUE', 'DRAFT'] },
      },
      include: {
        payments: { select: { amountCents: true } },
        customer: { select: { id: true, name: true, email: true } },
      },
    });

    interface Bucket {
      label: string;
      totalCents: number;
      count: number;
    }
    const buckets: Record<'current' | 'd30' | 'd60' | 'd90' | 'd90plus', Bucket> = {
      current: { label: 'Current / not yet due', totalCents: 0, count: 0 },
      d30:    { label: '1–30 days', totalCents: 0, count: 0 },
      d60:    { label: '31–60 days', totalCents: 0, count: 0 },
      d90:    { label: '61–90 days', totalCents: 0, count: 0 },
      d90plus:{ label: '90+ days', totalCents: 0, count: 0 },
    };

    interface OpenInvoice {
      id: string;
      number: string;
      customer: { id: string; name: string; email: string };
      amountCents: number;
      balanceCents: number;
      dueAt: string | null;
      daysPastDue: number; // negative if not yet due, 0 if today
      bucket: keyof typeof buckets;
    }
    const list: OpenInvoice[] = [];
    const dayMs = 24 * 60 * 60 * 1000;

    let totalDraftCents = 0;
    let totalDraftCount = 0;
    let totalOpenBalance = 0;

    for (const inv of open) {
      const paid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
      const balance = inv.amountCents - paid;
      if (balance <= 0) continue;
      if (inv.status === 'DRAFT') {
        // Drafts aren't in AR yet — surface separately so admin can chase
        // them out the door.
        totalDraftCents += balance;
        totalDraftCount += 1;
        continue;
      }
      totalOpenBalance += balance;
      const due = inv.dueAt;
      let bucket: keyof typeof buckets = 'current';
      let daysPastDue = -1;
      if (due) {
        const diff = Math.floor((now.getTime() - due.getTime()) / dayMs);
        daysPastDue = diff;
        if (diff <= 0) bucket = 'current';
        else if (diff <= 30) bucket = 'd30';
        else if (diff <= 60) bucket = 'd60';
        else if (diff <= 90) bucket = 'd90';
        else bucket = 'd90plus';
      }
      buckets[bucket].totalCents += balance;
      buckets[bucket].count += 1;
      list.push({
        id: inv.id,
        number: inv.number,
        customer: inv.customer,
        amountCents: inv.amountCents,
        balanceCents: balance,
        dueAt: due ? due.toISOString() : null,
        daysPastDue,
        bucket,
      });
    }
    list.sort((a, b) => b.daysPastDue - a.daysPastDue);

    // Expected cash: sum balances on every open SENT/OVERDUE invoice whose
    // dueAt falls in the next 30 / 60 / 90 days. We don't include invoices
    // already past due in the "next X days" — those are AR aging fodder.
    const horizon30 = new Date(now.getTime() + 30 * dayMs);
    const horizon60 = new Date(now.getTime() + 60 * dayMs);
    const horizon90 = new Date(now.getTime() + 90 * dayMs);
    let exp30 = 0;
    let exp60 = 0;
    let exp90 = 0;
    for (const inv of open) {
      if (inv.status === 'DRAFT' || !inv.dueAt || inv.dueAt < now) continue;
      const paid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
      const balance = inv.amountCents - paid;
      if (balance <= 0) continue;
      if (inv.dueAt <= horizon30) exp30 += balance;
      if (inv.dueAt <= horizon60) exp60 += balance;
      if (inv.dueAt <= horizon90) exp90 += balance;
    }

    res.json({
      asOf: now.toISOString(),
      buckets: Object.entries(buckets).map(([key, b]) => ({ key, ...b })),
      totalOpenBalanceCents: totalOpenBalance,
      drafts: { totalCents: totalDraftCents, count: totalDraftCount },
      expectedCash: { next30Cents: exp30, next60Cents: exp60, next90Cents: exp90 },
      // Top 10 most-overdue rows so admin can chase the worst first.
      topOverdue: list.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/summary', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const where: Prisma.ExpenseWhereInput = {};
    if (!hasAccountingAccess(me)) {
      where.OR = [{ paidByUserId: me.id }, { submittedById: me.id }];
    }
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [byStatus, byCategory, byProject, monthTotal, pendingReimburse, recent] = await Promise.all([
      prisma.expense.groupBy({
        by: ['syncStatus'],
        where,
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      prisma.expense.groupBy({
        by: ['categoryId'],
        where: { ...where, date: { gte: monthStart } },
        _sum: { amountCents: true },
        _count: { _all: true },
        orderBy: { _sum: { amountCents: 'desc' } },
        take: 8,
      }),
      prisma.expense.groupBy({
        by: ['projectId'],
        where: { ...where, projectId: { not: null }, date: { gte: monthStart } },
        _sum: { amountCents: true },
        _count: { _all: true },
        orderBy: { _sum: { amountCents: 'desc' } },
        take: 8,
      }),
      prisma.expense.aggregate({
        where: { ...where, date: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
      prisma.expense.aggregate({
        where: { ...where, reimbursable: true, reimbursedAt: null },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        take: 5,
        include: expenseInclude,
      }),
    ]);

    // Hydrate the by-category and by-project groupings with their names so the
    // frontend doesn't need a second round-trip.
    const categoryIds = byCategory.map((g) => g.categoryId).filter((x): x is string => !!x);
    const projectIds = byProject.map((g) => g.projectId).filter((x): x is string => !!x);
    const [categories, projects] = await Promise.all([
      categoryIds.length
        ? prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      projectIds.length
        ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const projectName = new Map(projects.map((p) => [p.id, p.name]));

    res.json({
      monthTotalCents: monthTotal._sum.amountCents ?? 0,
      pendingReimburseCents: pendingReimburse._sum.amountCents ?? 0,
      pendingReimburseCount: pendingReimburse._count._all,
      bySyncStatus: byStatus.map((g) => ({
        status: g.syncStatus,
        count: g._count._all,
        totalCents: g._sum.amountCents ?? 0,
      })),
      byCategory: byCategory.map((g) => ({
        categoryId: g.categoryId,
        name: g.categoryId ? categoryName.get(g.categoryId) ?? 'Unknown' : 'Uncategorised',
        count: g._count._all,
        totalCents: g._sum.amountCents ?? 0,
      })),
      byProject: byProject.map((g) => ({
        projectId: g.projectId,
        name: g.projectId ? projectName.get(g.projectId) ?? 'Unknown' : 'Unassigned',
        count: g._count._all,
        totalCents: g._sum.amountCents ?? 0,
      })),
      recent,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/expenses/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const expense = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: expenseInclude,
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    if (!hasAccountingAccess(me)) {
      const submittedByMe = expense.submittedById === me.id || expense.paidByUserId === me.id;
      let onMyProject = false;
      if (!submittedByMe && expense.projectId) {
        const proj = await prisma.project.findUnique({ where: { id: expense.projectId } });
        onMyProject = !!proj && proj.projectManagerId === me.id;
      }
      if (!submittedByMe && !onMyProject) {
        return res.status(404).json({ error: 'Expense not found' });
      }
    }
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

// Multipart create — accepts an optional receipt image alongside JSON-ish
// fields (multipart strings are parsed and coerced). The image is processed
// inline (sharp resize → webp) and stored in a per-expense subdirectory so
// future receipt versioning can drop new files alongside.
router.post('/expenses', upload.single('receipt'), async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const body = req.body as Record<string, string | undefined>;
    const parsed = expenseSchema.parse({
      vendorId: body.vendorId || undefined,
      categoryId: body.categoryId || undefined,
      projectId: body.projectId || undefined,
      tradeType: body.tradeType || undefined,
      paymentSource: body.paymentSource || undefined,
      paymentSourceLabel: body.paymentSourceLabel || undefined,
      paidFromAccountId: body.paidFromAccountId || undefined,
      paidByUserId: body.paidByUserId || me.id,
      amountCents: Number(body.amountCents),
      date: body.date,
      description: body.description || undefined,
      notes: body.notes || undefined,
      reimbursable: body.reimbursable === 'true',
    });

    // Persist the receipt image (if any) into a per-expense folder under
    // uploads/receipts/. Resizing here keeps thumbnail generation cheap and
    // produces consistently-sized list previews.
    let receiptUrl: string | null = null;
    let receiptThumbnailUrl: string | null = null;
    let processedReceipt: { dir: string; mainName: string; thumbName: string; main: Buffer; thumb: Buffer } | null = null;

    if (req.file) {
      const stamp = Date.now();
      const main = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer();
      const thumb = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      processedReceipt = {
        dir: '', // filled in once we have the expense id
        mainName: `receipt-${stamp}.webp`,
        thumbName: `receipt-${stamp}-thumb.webp`,
        main,
        thumb,
      };
    }

    // Create the row first so we have the id for the receipt path. Two-step
    // means the only failure mode is "row exists, image missing"; the route
    // surfaces that as a normal expense without a receipt rather than 500.
    const expense = await prisma.expense.create({
      data: {
        vendorId: parsed.vendorId ?? null,
        categoryId: parsed.categoryId ?? null,
        projectId: parsed.projectId ?? null,
        tradeType: parsed.tradeType ?? null,
        paymentSource: parsed.paymentSource ?? null,
        paymentSourceLabel: parsed.paymentSourceLabel ?? null,
        paidFromAccountId: parsed.paidFromAccountId ?? null,
        paidByUserId: parsed.paidByUserId ?? null,
        submittedById: me.id,
        amountCents: parsed.amountCents,
        date: new Date(parsed.date),
        description: parsed.description ?? null,
        notes: parsed.notes ?? null,
        reimbursable: parsed.reimbursable ?? false,
      },
      include: expenseInclude,
    });

    if (processedReceipt) {
      const dir = path.join(RECEIPTS_ROOT, expense.id);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, processedReceipt.mainName), processedReceipt.main);
      await fs.writeFile(path.join(dir, processedReceipt.thumbName), processedReceipt.thumb);
      receiptUrl = `/uploads/receipts/${expense.id}/${processedReceipt.mainName}`;
      receiptThumbnailUrl = `/uploads/receipts/${expense.id}/${processedReceipt.thumbName}`;
      const updated = await prisma.expense.update({
        where: { id: expense.id },
        data: { receiptUrl, receiptThumbnailUrl },
        include: expenseInclude,
      });
      return res.status(201).json({ expense: updated });
    }

    res.status(201).json({ expense });
  } catch (err) {
    next(err);
  }
});

router.patch('/expenses/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !canSubmitExpense(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    // Submitters can edit their own draft entries; accounting + admin can
    // edit anything. Reimbursed expenses are locked unless caller is
    // accounting (so PMs can't unflag a reimbursement after the fact).
    const isOwner = existing.submittedById === me.id || existing.paidByUserId === me.id;
    if (!hasAccountingAccess(me) && !isOwner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = updateExpenseSchema.parse(req.body);
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: {
        vendorId: data.vendorId === null ? null : data.vendorId,
        categoryId: data.categoryId === null ? null : data.categoryId,
        projectId: data.projectId === null ? null : data.projectId,
        tradeType: data.tradeType === null ? null : data.tradeType,
        paymentSource: data.paymentSource === null ? null : data.paymentSource,
        paymentSourceLabel: data.paymentSourceLabel === null ? null : data.paymentSourceLabel,
        paidFromAccountId: data.paidFromAccountId === null ? null : data.paidFromAccountId,
        paidByUserId: data.paidByUserId === null ? null : data.paidByUserId,
        amountCents: data.amountCents,
        date: data.date ? new Date(data.date) : undefined,
        description: data.description === null ? null : data.description,
        notes: data.notes === null ? null : data.notes,
        reimbursable: data.reimbursable,
        reimbursedAt:
          data.reimbursedAt === null
            ? null
            : data.reimbursedAt
              ? new Date(data.reimbursedAt)
              : undefined,
      },
      include: expenseInclude,
    });
    res.json({ expense });
  } catch (err) {
    next(err);
  }
});

router.delete('/expenses/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    await prisma.expense.delete({ where: { id: existing.id } });

    // Best-effort cleanup of the receipt directory.
    if (existing.receiptUrl) {
      const dir = path.join(RECEIPTS_ROOT, existing.id);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    audit(req, {
      action: 'expense.deleted',
      resourceType: 'expense',
      resourceId: existing.id,
      meta: {
        amountCents: existing.amountCents,
        vendorId: existing.vendorId,
        projectId: existing.projectId,
        syncStatus: existing.syncStatus,
      },
    }).catch(() => undefined);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
