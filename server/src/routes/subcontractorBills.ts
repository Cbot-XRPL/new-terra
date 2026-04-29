import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { PaymentMethod, Role, SubcontractorBillStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// Attachment storage: same uploads root as project images, under a
// 'sub-bills/<billId>' tree. Multer drops files there; sharp generates
// a thumb only when the upload is an image.
const ATTACH_ROOT = path.resolve(process.cwd(), 'uploads', 'sub-bills');
fsSync.mkdirSync(ATTACH_ROOT, { recursive: true });
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(ATTACH_ROOT, req.params.id);
      fsSync.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename(_req, file, cb) {
      const stamp = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${stamp}-${safe}`);
    },
  }),
  // 25 MB cap covers most subcontractor PDF invoices + photo evidence.
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function nextBillNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SB-${year}-`;
  const last = await prisma.subcontractorBill.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function loadActor(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

// Pay requests bundled from time entries, grouped by user × ISO week.
// Admin/accounting see one row per worker per week with the running
// total. Used as a payroll review surface alongside the explicit
// SubcontractorBill rows. Hourly entries are sized by minutes ×
// hourlyRateCents; daily entries by dayUnits × dailyRateCents (both
// snapshotted on the entry, so historical changes don't shift money).

function isoWeekStart(d: Date): Date {
  const day = d.getDay();
  // Anchor each week to Monday; Sunday (0) shifts back six days.
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function entryAmountCents(e: {
  minutes: number;
  dayUnits: number | null;
  hourlyRateCents: number;
  dailyRateCents: number;
}): number {
  if (e.dayUnits != null && e.dayUnits > 0) {
    return Math.round(e.dayUnits * e.dailyRateCents);
  }
  return Math.round((e.minutes * e.hourlyRateCents) / 60);
}

router.get('/pay-requests', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Default to the last 8 weeks; caller can widen via ?weeks=N.
    const weeks = Math.min(52, Math.max(1, Number(req.query.weeks ?? 8)));
    const since = isoWeekStart(new Date());
    since.setDate(since.getDate() - 7 * (weeks - 1));

    const entries = await prisma.timeEntry.findMany({
      where: {
        startedAt: { gte: since },
        endedAt: { not: null }, // skip "on the clock" entries
      },
      orderBy: { startedAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, role: true, billingMode: true } },
        project: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
      },
    });

    interface BundleEntry {
      id: string;
      startedAt: string;
      endedAt: string | null;
      minutes: number;
      dayUnits: number | null;
      notes: string | null;
      amountCents: number;
      project: { id: string; name: string } | null;
      status: 'pending' | 'approved' | 'rejected';
      rejectedReason: string | null;
      rejectedAt: string | null;
      approvedAt: string | null;
    }

    interface Bundle {
      key: string;
      userId: string;
      userName: string;
      role: 'EMPLOYEE' | 'SUBCONTRACTOR' | 'ADMIN' | 'CUSTOMER';
      billingMode: 'HOURLY' | 'DAILY';
      weekStart: string;
      weekEnd: string;
      totalMinutes: number;
      totalDayUnits: number;
      // Active total = sum of non-rejected entries' amounts. Rejected
      // entries don't get paid, so they're excluded from the bundle total.
      totalCents: number;
      entryCount: number;
      projects: Array<{ id: string; name: string; cents: number }>;
      entries: BundleEntry[];
      // 'pending' = at least one non-rejected entry awaits approval
      // 'approved' = every non-rejected entry has approvedAt set
      status: 'pending' | 'approved';
    }

    const bundles = new Map<string, Bundle>();
    for (const e of entries) {
      const ws = isoWeekStart(new Date(e.startedAt));
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      we.setHours(23, 59, 59, 999);
      const key = `${e.userId}|${ws.toISOString().slice(0, 10)}`;
      const amount = entryAmountCents({
        minutes: e.minutes,
        dayUnits: e.dayUnits,
        hourlyRateCents: e.hourlyRateCents,
        dailyRateCents: e.dailyRateCents,
      });
      const isRejected = e.rejectedAt != null;
      const isApproved = e.approvedAt != null;
      let b = bundles.get(key);
      if (!b) {
        b = {
          key,
          userId: e.userId,
          userName: e.user.name,
          role: e.user.role,
          billingMode: e.user.billingMode,
          weekStart: ws.toISOString(),
          weekEnd: we.toISOString(),
          totalMinutes: 0,
          totalDayUnits: 0,
          totalCents: 0,
          entryCount: 0,
          projects: [],
          entries: [],
          status: 'approved', // assume; demoted below if any entry is pending
        };
        bundles.set(key, b);
      }
      b.entries.push({
        id: e.id,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt ? e.endedAt.toISOString() : null,
        minutes: e.minutes,
        dayUnits: e.dayUnits,
        notes: e.notes,
        amountCents: amount,
        project: e.project ? { id: e.project.id, name: e.project.name } : null,
        status: isRejected ? 'rejected' : isApproved ? 'approved' : 'pending',
        rejectedReason: e.rejectedReason,
        rejectedAt: e.rejectedAt ? e.rejectedAt.toISOString() : null,
        approvedAt: e.approvedAt ? e.approvedAt.toISOString() : null,
      });
      b.entryCount += 1;
      if (!isRejected) {
        b.totalMinutes += e.minutes;
        b.totalDayUnits += e.dayUnits ?? 0;
        b.totalCents += amount;
        if (!isApproved) b.status = 'pending';
        if (e.project) {
          const existing = b.projects.find((p) => p.id === e.project!.id);
          if (existing) existing.cents += amount;
          else b.projects.push({ id: e.project.id, name: e.project.name, cents: amount });
        }
      }
    }

    // If a bundle has only rejected entries, treat it as approved (nothing
    // to review). If it has no entries at all (impossible, but defensive)
    // it stays approved by default.
    for (const b of bundles.values()) {
      const nonRejected = b.entries.filter((e) => e.status !== 'rejected');
      if (nonRejected.length === 0) {
        b.status = 'approved';
      }
    }

    // Sort newest week first, then by total descending within a week.
    const out = [...bundles.values()].sort((a, b) =>
      a.weekStart === b.weekStart
        ? b.totalCents - a.totalCents
        : b.weekStart.localeCompare(a.weekStart),
    );
    res.json({ bundles: out });
  } catch (err) {
    next(err);
  }
});

// Approve every non-rejected entry in a weekly bundle in one call. Bundle
// is identified by userId + weekStart (ISO date); approvedAt + approvedBy
// are stamped on each affected entry.
router.post('/pay-requests/approve-bundle', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const schema = z.object({
      userId: z.string().min(1),
      weekStart: z.string().datetime(),
    });
    const { userId, weekStart } = schema.parse(req.body);
    const ws = new Date(weekStart);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 7);
    const result = await prisma.timeEntry.updateMany({
      where: {
        userId,
        startedAt: { gte: ws, lt: we },
        rejectedAt: null,
        approvedAt: null,
      },
      data: { approvedAt: new Date(), approvedById: me.id },
    });
    res.json({ approved: result.count });
  } catch (err) {
    next(err);
  }
});

// Un-approve a bundle (admin caught a mistake after approving).
router.post('/pay-requests/unapprove-bundle', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const schema = z.object({
      userId: z.string().min(1),
      weekStart: z.string().datetime(),
    });
    const { userId, weekStart } = schema.parse(req.body);
    const ws = new Date(weekStart);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 7);
    const result = await prisma.timeEntry.updateMany({
      where: {
        userId,
        startedAt: { gte: ws, lt: we },
        approvedAt: { not: null },
      },
      data: { approvedAt: null, approvedById: null },
    });
    res.json({ unapproved: result.count });
  } catch (err) {
    next(err);
  }
});

// Subcontractors see only their own bills. Admin / accounting see everything.
// Plain employees never see them — this is a finance/COGS surface.
router.get('/', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    let where: { subcontractorId?: string } = {};
    if (me.role === Role.SUBCONTRACTOR) {
      where = { subcontractorId: me.id };
    } else if (!hasAccountingAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const bills = await prisma.subcontractorBill.findMany({
      where,
      orderBy: [{ status: 'asc' }, { receivedAt: 'desc' }],
      include: {
        subcontractor: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        expense: { select: { id: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
      },
    });
    res.json({ bills });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  // Optional: admin/accounting can record on a sub's behalf. When omitted
  // and the caller is a sub, defaults to themselves.
  subcontractorId: z.string().min(1).optional(),
  projectId: z.string().min(1).nullable().optional(),
  externalNumber: z.string().max(60).nullable().optional(),
  amountCents: z.number().int().positive(),
  receivedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const data = createSchema.parse(req.body);

    // Subs can only file their own; staff with accounting can file on
    // behalf of a sub.
    let subId: string;
    if (me.role === Role.SUBCONTRACTOR) {
      subId = me.id;
    } else if (hasAccountingAccess(me)) {
      if (!data.subcontractorId) return res.status(400).json({ error: 'subcontractorId is required' });
      const sub = await prisma.user.findUnique({ where: { id: data.subcontractorId } });
      if (!sub || sub.role !== Role.SUBCONTRACTOR) {
        return res.status(400).json({ error: 'subcontractorId must reference a subcontractor' });
      }
      subId = sub.id;
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const number = await nextBillNumber();
    const bill = await prisma.subcontractorBill.create({
      data: {
        number,
        subcontractorId: subId,
        projectId: data.projectId ?? null,
        externalNumber: data.externalNumber ?? null,
        amountCents: data.amountCents,
        receivedAt: data.receivedAt ? new Date(data.receivedAt) : new Date(),
        notes: data.notes ?? null,
        status: SubcontractorBillStatus.PENDING,
      },
    });
    audit(req, {
      action: 'subBill.created',
      resourceType: 'subcontractorBill',
      resourceId: bill.id,
      meta: { amountCents: data.amountCents, projectId: data.projectId, subcontractorId: subId },
    }).catch(() => undefined);
    res.status(201).json({ bill });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  externalNumber: z.string().max(60).nullable().optional(),
  amountCents: z.number().int().positive().optional(),
  projectId: z.string().min(1).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const data = patchSchema.parse(req.body);
    const existing = await prisma.subcontractorBill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Bill not found' });
    if (existing.status === SubcontractorBillStatus.PAID) {
      return res.status(409).json({ error: 'Cannot edit a paid bill — void and resubmit instead' });
    }
    const bill = await prisma.subcontractorBill.update({
      where: { id: existing.id },
      data: {
        externalNumber: data.externalNumber === null ? null : data.externalNumber,
        amountCents: data.amountCents,
        projectId: data.projectId === null ? null : data.projectId,
        notes: data.notes === null ? null : data.notes,
      },
    });
    res.json({ bill });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const existing = await prisma.subcontractorBill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Bill not found' });
    if (existing.status !== SubcontractorBillStatus.PENDING) {
      return res.status(409).json({ error: `Cannot approve a ${existing.status.toLowerCase()} bill` });
    }
    const bill = await prisma.subcontractorBill.update({
      where: { id: existing.id },
      data: {
        status: SubcontractorBillStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: me.id,
      },
    });
    res.json({ bill });
  } catch (err) {
    next(err);
  }
});

const paySchema = z.object({
  paidMethod: z.nativeEnum(PaymentMethod),
  paidReference: z.string().max(80).nullable().optional(),
  paidAt: z.string().datetime().optional(),
});

// Mark a bill PAID and auto-write an Expense row tagged to the project
// so the cost lands in job costing. Wrapped in a transaction so a half-
// finished pay action can't leave a "PAID bill with no expense".
router.post('/:id/pay', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const data = paySchema.parse(req.body);
    const existing = await prisma.subcontractorBill.findUnique({
      where: { id: req.params.id },
      include: { subcontractor: { select: { id: true, name: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Bill not found' });
    if (existing.status === SubcontractorBillStatus.PAID) {
      return res.status(409).json({ error: 'Already paid' });
    }
    if (existing.status === SubcontractorBillStatus.VOID) {
      return res.status(409).json({ error: 'Cannot pay a voided bill' });
    }

    // Find the "Subcontractors" category, creating it on first use so admins
    // don't have to seed it manually.
    const category = await prisma.expenseCategory.upsert({
      where: { id: '__sub_cat_seed__' }, // dummy key — real lookup is by name
      update: {},
      create: { id: '__sub_cat_seed__', name: 'Subcontractors' },
    }).catch(async () => {
      // If the seed-id collision logic above is awkward, fall back to a
      // plain "find by name" upsert.
      const found = await prisma.expenseCategory.findFirst({ where: { name: 'Subcontractors' } });
      return found ?? prisma.expenseCategory.create({ data: { name: 'Subcontractors' } });
    });

    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          projectId: existing.projectId,
          categoryId: category.id,
          paidByUserId: me.id,
          submittedById: me.id,
          amountCents: existing.amountCents,
          date: paidAt,
          description: `Subcontractor: ${existing.subcontractor.name}${existing.externalNumber ? ` (#${existing.externalNumber})` : ''}`,
          notes: existing.notes,
        },
      });
      return tx.subcontractorBill.update({
        where: { id: existing.id },
        data: {
          status: SubcontractorBillStatus.PAID,
          paidAt,
          paidMethod: data.paidMethod,
          paidReference: data.paidReference ?? null,
          expenseId: expense.id,
        },
        include: { expense: { select: { id: true } } },
      });
    });

    audit(req, {
      action: 'subBill.paid',
      resourceType: 'subcontractorBill',
      resourceId: updated.id,
      meta: { amountCents: updated.amountCents, expenseId: updated.expenseId, method: data.paidMethod },
    }).catch(() => undefined);
    res.json({ bill: updated });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/void', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const existing = await prisma.subcontractorBill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Bill not found' });
    if (existing.status === SubcontractorBillStatus.PAID) {
      return res.status(409).json({ error: 'Cannot void a paid bill — delete the expense first if needed' });
    }
    const bill = await prisma.subcontractorBill.update({
      where: { id: existing.id },
      data: { status: SubcontractorBillStatus.VOID },
    });
    res.json({ bill });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const existing = await prisma.subcontractorBill.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Bill not found' });
    if (existing.status === SubcontractorBillStatus.PAID && existing.expenseId) {
      // Drop the auto-created expense alongside so job costing stays accurate.
      await prisma.expense.delete({ where: { id: existing.expenseId } }).catch(() => undefined);
    }
    await prisma.subcontractorBill.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ----- Attachments -----
//
// Subs upload PDFs / photos of their actual invoice while the bill is
// PENDING; once accounting approves it, only accounting/admin can attach
// (or remove) — locks down evidence after sign-off. Anyone who can read
// the parent bill can see the attachment list (already gated above).

async function loadBillForAttachment(id: string, me: { id: string; role: Role }, isAccounting: boolean) {
  const bill = await prisma.subcontractorBill.findUnique({ where: { id } });
  if (!bill) return { error: 404 as const };
  if (me.role === Role.SUBCONTRACTOR) {
    if (bill.subcontractorId !== me.id) return { error: 404 as const };
    if (bill.status !== SubcontractorBillStatus.PENDING) {
      return { error: 409 as const };
    }
  } else if (!isAccounting) {
    return { error: 403 as const };
  }
  return { bill };
}

router.post(
  '/:id/attachments',
  attachmentUpload.array('files', 8),
  async (req, res, next) => {
    try {
      const me = await loadActor(req.user!.sub);
      if (!me) return res.status(401).json({ error: 'Unauthenticated' });
      const isAccounting = hasAccountingAccess(me);
      const result = await loadBillForAttachment(req.params.id, me, isAccounting);
      if (result.error === 404) return res.status(404).json({ error: 'Bill not found' });
      if (result.error === 403) return res.status(403).json({ error: 'Forbidden' });
      if (result.error === 409) return res.status(409).json({ error: 'Bill is already approved or paid; cannot attach more files' });
      const bill = result.bill!;

      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) return res.status(400).json({ error: 'No files received' });

      const created = [];
      for (const f of files) {
        const url = `/uploads/sub-bills/${bill.id}/${f.filename}`;
        let thumbnailUrl: string | null = null;
        if (f.mimetype.startsWith('image/')) {
          try {
            const buf = await fs.readFile(f.path);
            const thumb = await sharp(buf)
              .rotate()
              .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 78 })
              .toBuffer();
            const thumbName = `thumb-${path.parse(f.filename).name}.webp`;
            const thumbPath = path.join(ATTACH_ROOT, bill.id, thumbName);
            await fs.writeFile(thumbPath, thumb);
            thumbnailUrl = `/uploads/sub-bills/${bill.id}/${thumbName}`;
          } catch (err) {
            console.warn('[sub-bill] thumbnail failed', err);
          }
        }
        const att = await prisma.subcontractorBillAttachment.create({
          data: {
            billId: bill.id,
            uploadedById: me.id,
            filename: f.originalname,
            url,
            thumbnailUrl,
            contentType: f.mimetype,
            sizeBytes: f.size,
          },
          include: { uploadedBy: { select: { id: true, name: true } } },
        });
        created.push(att);
      }

      audit(req, {
        action: 'subBill.attachment_added',
        resourceType: 'subcontractorBill',
        resourceId: bill.id,
        meta: { count: created.length },
      }).catch(() => undefined);
      res.status(201).json({ attachments: created });
    } catch (err) {
      next(err);
    }
  },
);

router.delete('/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const isAccounting = hasAccountingAccess(me);
    const result = await loadBillForAttachment(req.params.id, me, isAccounting);
    if (result.error === 404) return res.status(404).json({ error: 'Bill not found' });
    if (result.error === 403) return res.status(403).json({ error: 'Forbidden' });
    if (result.error === 409) return res.status(409).json({ error: 'Bill is approved or paid; cannot remove attachments' });
    const bill = result.bill!;

    const att = await prisma.subcontractorBillAttachment.findUnique({
      where: { id: req.params.attachmentId },
    });
    if (!att || att.billId !== bill.id) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    // Only the original uploader (if a sub) can delete; accounting can delete anyone's.
    if (me.role === Role.SUBCONTRACTOR && att.uploadedById !== me.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.subcontractorBillAttachment.delete({ where: { id: att.id } });
    // Best-effort filesystem cleanup. Missing file is fine.
    for (const u of [att.url, att.thumbnailUrl].filter(Boolean) as string[]) {
      const filePath = path.join(process.cwd(), u.replace(/^\/+/, ''));
      await fs.unlink(filePath).catch(() => undefined);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
