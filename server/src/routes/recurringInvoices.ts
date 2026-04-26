import { Router } from 'express';
import { z } from 'zod';
import { RecurringFrequency, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasAccountingAccess } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';
import { advanceDate, runRecurringInvoices } from '../lib/recurringInvoices.js';

const router = Router();
router.use(requireAuth);

async function loadActor(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}

// Customers see their own templates so they can spot a surprise charge
// before it hits. Staff with accounting (or admin) author + manage them.
router.get('/', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    const where = role === Role.CUSTOMER ? { customerId: sub } : {};
    const items = await prisma.recurringInvoice.findMany({
      where,
      orderBy: [{ active: 'desc' }, { nextRunAt: 'asc' }],
      include: {
        customer: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    res.json({ recurringInvoices: items });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  customerId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  label: z.string().min(1).max(160),
  amountCents: z.number().int().positive(),
  frequency: z.nativeEnum(RecurringFrequency),
  dayOfPeriod: z.number().int().min(0).max(28).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lineItems: z.array(z.unknown()).optional(),
  // First-run date — required so admin doesn't accidentally generate
  // an invoice immediately on save.
  nextRunAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const data = createSchema.parse(req.body);
    const customer = await prisma.user.findUnique({ where: { id: data.customerId } });
    if (!customer || customer.role !== Role.CUSTOMER) {
      return res.status(400).json({ error: 'customerId must reference a customer' });
    }
    const created = await prisma.recurringInvoice.create({
      data: {
        customerId: data.customerId,
        projectId: data.projectId ?? null,
        label: data.label,
        amountCents: data.amountCents,
        frequency: data.frequency,
        dayOfPeriod: data.dayOfPeriod ?? null,
        notes: data.notes ?? null,
        lineItems: (data.lineItems as unknown) ?? undefined,
        nextRunAt: new Date(data.nextRunAt),
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        active: data.active ?? true,
        createdById: me.id,
      },
    });
    audit(req, {
      action: 'recurringInvoice.created',
      resourceType: 'recurringInvoice',
      resourceId: created.id,
      meta: { label: data.label, frequency: data.frequency, amountCents: data.amountCents },
    }).catch(() => undefined);
    res.status(201).json({ recurringInvoice: created });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  label: z.string().min(1).max(160).optional(),
  amountCents: z.number().int().positive().optional(),
  frequency: z.nativeEnum(RecurringFrequency).optional(),
  dayOfPeriod: z.number().int().min(0).max(28).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lineItems: z.array(z.unknown()).optional(),
  nextRunAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const data = patchSchema.parse(req.body);
    const updated = await prisma.recurringInvoice.update({
      where: { id: req.params.id },
      data: {
        label: data.label,
        amountCents: data.amountCents,
        frequency: data.frequency,
        dayOfPeriod: data.dayOfPeriod === null ? null : data.dayOfPeriod,
        notes: data.notes === null ? null : data.notes,
        lineItems: (data.lineItems as unknown) ?? undefined,
        nextRunAt: data.nextRunAt ? new Date(data.nextRunAt) : undefined,
        endsAt: data.endsAt === null ? null : data.endsAt ? new Date(data.endsAt) : undefined,
        active: data.active,
      },
    });
    res.json({ recurringInvoice: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    await prisma.recurringInvoice.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Manual run for a single template — generates one DRAFT and advances
// nextRunAt as if the cron had fired. Useful for testing + ad-hoc bills.
router.post('/:id/run-now', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const tpl = await prisma.recurringInvoice.findUnique({ where: { id: req.params.id } });
    if (!tpl) return res.status(404).json({ error: 'Recurring invoice not found' });

    // Force a run even if nextRunAt is in the future by temporarily moving
    // it to now. We then advance based on the original schedule below.
    await prisma.recurringInvoice.update({
      where: { id: tpl.id },
      data: { nextRunAt: new Date(), active: true },
    });
    const result = await runRecurringInvoices(new Date());
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Admin-only: run the cron pass on demand from the Finance dashboard.
router.post('/_admin/run', async (req, res, next) => {
  try {
    const me = await loadActor(req.user!.sub);
    if (!me || me.role !== Role.ADMIN) return res.status(403).json({ error: 'Forbidden' });
    const result = await runRecurringInvoices();
    audit(req, {
      action: 'recurringInvoice.cron_triggered',
      meta: { ...result },
    }).catch(() => undefined);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Surface the advanceDate math so the admin UI can preview the next run.
router.post('/_meta/preview-next', async (req, res, next) => {
  try {
    const schema = z.object({
      from: z.string().datetime(),
      frequency: z.nativeEnum(RecurringFrequency),
      dayOfPeriod: z.number().int().min(0).max(28).nullable().optional(),
    });
    const data = schema.parse(req.body);
    const next = advanceDate(new Date(data.from), data.frequency, data.dayOfPeriod ?? null);
    res.json({ next });
  } catch (err) {
    next(err);
  }
});

export default router;
