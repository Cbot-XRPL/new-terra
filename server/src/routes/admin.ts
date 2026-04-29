import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateInviteToken } from '../lib/auth.js';
import { sendInviteEmail } from '../lib/mailer.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { runUploadJanitor } from '../lib/uploadJanitor.js';

const router = Router();

router.use(requireAuth, requireRole(Role.ADMIN));

// Manual run of the orphaned-upload janitor. Pass ?dryRun=true to see
// candidates without deleting anything. Returns a per-bucket summary.
router.post('/janitor/uploads', async (req, res, next) => {
  try {
    const dryRun = req.query.dryRun === 'true';
    const results = await runUploadJanitor({ dryRun });
    audit(req, {
      action: 'admin.janitor_run',
      meta: { dryRun, totalRemoved: results.reduce((s, r) => s + r.orphanedRemoved, 0) },
    }).catch(() => undefined);
    res.json({ dryRun, results });
  } catch (err) { next(err); }
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(Role),
});

router.post('/invitations', async (req, res, next) => {
  try {
    const { email, role } = inviteSchema.parse(req.body);
    const normalized = email.toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email: normalized } });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await prisma.invitation.create({
      data: {
        email: normalized,
        role,
        tokenHash,
        expiresAt,
        invitedById: req.user!.sub,
      },
    });

    const inviteUrl = `${env.appUrl}/accept-invite?token=${token}`;
    await sendInviteEmail(normalized, inviteUrl, role);

    res.status(201).json({
      invitation: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
      // Returned in dev so admin can copy/paste the link if SMTP isn't set.
      inviteUrl: env.smtp.host ? undefined : inviteUrl,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/invitations', async (_req, res, next) => {
  try {
    const invites = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ invitations: invites });
  } catch (err) {
    next(err);
  }
});

const listUsersQuery = z.object({
  // Comma-separated roles, e.g. ?roles=EMPLOYEE,SUBCONTRACTOR
  roles: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
});

router.get('/users', async (req, res, next) => {
  try {
    const { roles, active } = listUsersQuery.parse(req.query);
    const where: { role?: { in: Role[] }; isActive?: boolean } = {};
    if (roles) {
      const parsed = roles
        .split(',')
        .map((r) => r.trim().toUpperCase())
        .filter((r): r is Role => (Object.values(Role) as string[]).includes(r));
      if (parsed.length) where.role = { in: parsed };
    }
    if (active) where.isActive = active === 'true';

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        isSales: true,
        isProjectManager: true,
        isAccounting: true,
        billingMode: true,
        dailyRateCents: true,
        taxId: true,
        mailingAddress: true,
        createdAt: true,
      },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.nativeEnum(Role).optional(),
  isSales: z.boolean().optional(),
  isProjectManager: z.boolean().optional(),
  isAccounting: z.boolean().optional(),
  billingMode: z.enum(['HOURLY', 'DAILY']).optional(),
  dailyRateCents: z.number().int().nonnegative().optional(),
  taxId: z.string().max(40).nullable().optional(),
  mailingAddress: z.string().max(400).nullable().optional(),
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = updateUserSchema.parse(req.body);
    const before = await prisma.user.findUnique({
      where: { id },
      select: { isActive: true, role: true, isSales: true, isProjectManager: true, isAccounting: true },
    });
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...data,
        taxId: data.taxId === null ? null : data.taxId,
        mailingAddress: data.mailingAddress === null ? null : data.mailingAddress,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        isSales: true,
        isProjectManager: true,
        isAccounting: true,
        billingMode: true,
        dailyRateCents: true,
        taxId: true,
        mailingAddress: true,
      },
    });
    // Record only the fields that actually changed so the audit trail stays
    // signal-heavy — granting/revoking capabilities is the interesting part.
    if (before) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['isActive', 'role', 'isSales', 'isProjectManager', 'isAccounting'] as const) {
        if (before[key] !== updated[key]) {
          changes[key] = { from: before[key], to: updated[key] };
        }
      }
      if (Object.keys(changes).length > 0) {
        audit(req, {
          action: 'admin.user_updated',
          resourceType: 'user',
          resourceId: id,
          meta: { changes },
        }).catch(() => undefined);
      }
    }
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

// Audit log read — admin only. Paginated, filterable by action prefix +
// resource type + actor.
const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().optional(),
  actorId: z.string().optional(),
  resourceType: z.string().optional(),
});

router.get('/audit', async (req, res, next) => {
  try {
    const q = auditQuery.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.action) where.action = { startsWith: q.action };
    if (q.actorId) where.actorId = q.actorId;
    if (q.resourceType) where.resourceType = q.resourceType;
    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditEvent.count({ where }),
    ]);
    res.json({ events, total, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    next(err);
  }
});

export default router;
