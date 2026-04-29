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

// Integrations checklist — what's wired up, what still needs configuration.
// Used by /portal/admin/integrations to give admin a one-page audit of
// what's plumbed in for production.
router.get('/integrations-status', async (_req, res, next) => {
  try {
    const [plaid, qb, board] = await Promise.all([
      prisma.plaidConnection.count(),
      prisma.qbConnection.count(),
      prisma.contractTemplate.count(),
    ]);

    function ok(value: boolean): 'ok' | 'todo' {
      return value ? 'ok' : 'todo';
    }

    res.json({
      items: [
        {
          key: 'app_url',
          label: 'APP_URL points at the public host',
          status: env.appUrl && env.appUrl !== 'http://localhost:5173' ? 'ok' : 'todo',
          detail: env.appUrl,
          docs: 'Set APP_URL in .env to your real domain before going live (it gets baked into invite + receipt emails).',
        },
        {
          key: 'jwt_secret',
          label: 'JWT_SECRET is non-default',
          status: env.jwtSecret.length >= 64 ? 'ok' : 'todo',
          docs: 'Generate with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
        },
        {
          key: 'admin_password',
          label: 'Bootstrap admin password changed',
          status: env.seedAdmin.password === 'changeMe!2026' ? 'todo' : 'ok',
          docs: 'Sign in as admin → profile → change password (or override SEED_ADMIN_PASSWORD before first seed in prod).',
        },
        {
          key: 'resend',
          label: 'Resend (outbound email) configured',
          status: ok(!!process.env.RESEND_API_KEY),
          docs: 'Sign up at resend.com → Account → API Keys. Verify a domain so emails don\'t go to spam.',
        },
        {
          key: 'resend_domain',
          label: 'Resend FROM uses your verified domain',
          status:
            process.env.RESEND_FROM && !process.env.RESEND_FROM.includes('onboarding@resend.dev')
              ? 'ok'
              : 'todo',
          detail: process.env.RESEND_FROM ?? null,
          docs: 'After domain verification at resend.com/domains, change RESEND_FROM in .env to e.g. "New Terra Construction <no-reply@newterraconstruction.com>".',
        },
        {
          key: 'plaid_keys',
          label: 'Plaid API keys present',
          status: ok(!!(env.plaid.clientId && env.plaid.secret)),
          detail: env.plaid.clientId ? `env: ${env.plaid.env}` : null,
          docs: 'dashboard.plaid.com → Team Settings → Keys. Set PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV in .env.',
        },
        {
          key: 'plaid_linked',
          label: 'At least one bank linked via Plaid',
          status: plaid > 0 ? 'ok' : 'todo',
          detail: plaid > 0 ? `${plaid} connection(s)` : null,
          docs: 'Banking page → Connect bank. Picks Chase/etc., user authenticates inside Plaid Link, transactions sync automatically.',
        },
        {
          key: 'qb',
          label: 'QuickBooks Online connected',
          status: qb > 0 ? 'ok' : 'todo',
          detail: qb > 0 ? `${qb} connection(s)` : null,
          docs: 'Optional. Skip if you don\'t use QuickBooks. Otherwise: Finance → Settings → Connect QuickBooks.',
        },
        {
          key: 'stripe',
          label: 'Stripe webhook secret set',
          status: ok(!!process.env.STRIPE_WEBHOOK_SECRET),
          docs: 'Optional — only needed if you want invoices to auto-mark PAID on Stripe payment. Set STRIPE_WEBHOOK_SECRET + STRIPE_SECRET_KEY in .env.',
        },
        {
          key: 'docusign',
          label: 'DocuSign integration configured',
          status: ok(!!process.env.DOCUSIGN_INTEGRATION_KEY),
          docs: 'Optional — contracts work via the in-portal typed-name flow without DocuSign. Set DOCUSIGN_* keys in .env to enable.',
        },
        {
          key: 'turnstile',
          label: 'Cloudflare Turnstile (contact-form captcha)',
          status: ok(!!process.env.TURNSTILE_SECRET_KEY),
          docs: 'Optional — public contact form runs without it. Set TURNSTILE_SECRET_KEY + VITE_TURNSTILE_SITE_KEY (in client/.env) to enable.',
        },
        {
          key: 'qb_encryption',
          label: 'QuickBooks token encryption key set',
          status: ok(!!process.env.QB_ENCRYPTION_KEY),
          docs: 'Set QB_ENCRYPTION_KEY in prod so QB tokens are encrypted independent of JWT_SECRET.',
        },
        {
          key: 'inquiry_to',
          label: 'Public contact form recipient (INQUIRY_TO) set',
          status: ok(!!process.env.INQUIRY_TO),
          detail: process.env.INQUIRY_TO ?? null,
          docs: 'Set INQUIRY_TO in .env to the address that receives leads from /contact.',
        },
        {
          key: 'contract_template',
          label: 'At least one contract template exists',
          status: board > 0 ? 'ok' : 'todo',
          docs: 'A "Standard residential construction agreement" is seeded on first install. Edit it under Templates to match your real wording.',
        },
      ],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
