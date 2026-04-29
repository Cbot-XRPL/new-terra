import { Router } from 'express';
import { z } from 'zod';
import { LeadSource, LeadStatus, Role, type Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { generateInviteToken } from '../lib/auth.js';
import { sendInviteEmail } from '../lib/mailer.js';
import { env } from '../env.js';
import { hasSalesAccess } from '../lib/permissions.js';
import { notifyStaleLeads } from '../lib/reminders.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  scope: z.string().max(2000).optional().nullable(),
  estimatedValueCents: z.number().int().nonnegative().optional().nullable(),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  ownerId: z.string().nullable().optional(),
  notes: z.string().max(5000).optional().nullable(),
});

const updateSchema = createSchema.partial();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.nativeEnum(LeadStatus).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  ownerId: z.string().optional(),
  // "mine" is a sales-friendly shortcut for ownerId=<self>
  mine: z.enum(['true', 'false']).optional(),
  q: z.string().trim().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'estimatedValueCents', 'name', 'status']).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

const activitySchema = z.object({
  type: z.string().min(1).max(40),
  body: z.string().min(1).max(5000),
});

const convertSchema = z.object({
  email: z.string().email().optional(),
  // When true and the lead has no convertedToCustomer yet, send an invitation
  // email to the lead's email so they can accept and create their account.
  sendInvite: z.boolean().default(true),
});

async function loadMe(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

router.get('/', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { page, pageSize, status, source, ownerId, mine, q, sort, dir } = listQuery.parse(req.query);
    const where: Prisma.LeadWhereInput = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (mine === 'true') {
      where.ownerId = me.id;
    } else if (ownerId) {
      where.ownerId = ownerId;
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { address: { contains: q, mode: 'insensitive' } },
        { scope: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [sort]: dir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          owner: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          convertedToCustomer: { select: { id: true, name: true, email: true } },
          _count: { select: { activities: true } },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/board-summary', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const grouped = await prisma.lead.groupBy({
      by: ['status'],
      _count: { _all: true },
      _sum: { estimatedValueCents: true },
    });
    res.json({
      byStatus: grouped.map((g) => ({
        status: g.status,
        count: g._count._all,
        valueCents: g._sum.estimatedValueCents ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        convertedToCustomer: { select: { id: true, name: true, email: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: { author: { select: { id: true, name: true, role: true } } },
        },
      },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = createSchema.parse(req.body);
    const lead = await prisma.lead.create({
      data: {
        ...data,
        // Default a new lead to the creator if no owner is set, so it doesn't
        // sit ownerless and forgotten.
        ownerId: data.ownerId ?? me.id,
        createdById: me.id,
      },
      include: { owner: { select: { id: true, name: true } } },
    });
    res.status(201).json({ lead });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    const data = updateSchema.parse(req.body);
    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data,
      include: { owner: { select: { id: true, name: true } } },
    });

    // Auto-log a status_change activity so the timeline tells the full story.
    if (data.status && data.status !== existing.status) {
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          authorId: me.id,
          type: 'status_change',
          body: `${existing.status.toLowerCase()} → ${data.status.toLowerCase()}`,
        },
      });
    }
    res.json({ lead });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    // Tighter than read: only admin can hard-delete a lead. Sales can mark LOST
    // through the regular update path.
    if (!me || me.role !== Role.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.lead.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/:id/activities', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = activitySchema.parse(req.body);
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const activity = await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        authorId: me.id,
        type: data.type,
        body: data.body,
      },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ activity });
  } catch (err) {
    next(err);
  }
});

// Convert a lead into a real customer account.
// - If a User already exists with the lead's email, link the lead to that user.
// - Otherwise create an Invitation; the recipient sets their own password
//   via the existing accept-invite flow.
router.post('/:id/convert', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = convertSchema.parse(req.body ?? {});
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.convertedToCustomerId) {
      return res.status(409).json({ error: 'Lead already converted' });
    }
    const email = (data.email ?? lead.email ?? '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Lead has no email; pass one in the body' });

    let customerId: string | null = null;
    let inviteUrl: string | undefined;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Link the lead to the existing user (no new invitation needed).
      customerId = existing.id;
    } else {
      const { token, tokenHash } = generateInviteToken();
      await prisma.invitation.create({
        data: {
          email,
          role: Role.CUSTOMER,
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedById: me.id,
        },
      });
      inviteUrl = `${env.appUrl}/accept-invite?token=${token}`;
      if (data.sendInvite) {
        await sendInviteEmail(email, inviteUrl, Role.CUSTOMER).catch((err) =>
          console.warn('[leads:convert] mail send failed', err),
        );
      }
    }

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.WON,
        convertedAt: new Date(),
        convertedToCustomerId: customerId,
      },
      include: { convertedToCustomer: { select: { id: true, name: true, email: true } } },
    });
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        authorId: me.id,
        type: 'status_change',
        body: customerId ? `Converted to existing customer ${email}` : `Invitation sent to ${email}`,
      },
    });

    res.json({
      lead: updated,
      // Echo the dev URL when no mail transport is configured so the rep
      // can copy it. Resend or SMTP both count as configured.
      inviteUrl: (env.resend.apiKey || env.smtp.host) ? undefined : inviteUrl,
    });
  } catch (err) {
    next(err);
  }
});

// Manual trigger for the stale-lead nudge — fires the same email path as
// the optional cron job below. Sales reps + admins can run it on demand
// from the leads page.
router.post('/admin/notify-stale', async (req, res, next) => {
  try {
    const me = await loadMe(req.user!.sub);
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const result = await notifyStaleLeads();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
