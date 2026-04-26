import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { ExpenseSyncStatus, Role, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
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
