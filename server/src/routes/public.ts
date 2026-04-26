import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { LeadSource, LeadStatus, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { sendInquiryEmail } from '../lib/mailer.js';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

async function verifyTurnstile(token: string | undefined, ip?: string): Promise<boolean> {
  // No secret configured means Turnstile is off — always pass.
  if (!TURNSTILE_SECRET) return true;
  if (!token) return false;
  // Bound the verification call so a slow Cloudflare doesn't hang the
  // whole signup request. 5s is generous; real responses come in <500ms.
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch (err) {
    console.warn('[turnstile] verification request failed', err);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 submissions per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  message: z.string().min(1).max(5000),
  // Honeypot — real users won't fill this; bots usually do. Validated leniently
  // so a filled value still parses; we silently succeed below.
  website: z.string().max(500).optional(),
  // Cloudflare Turnstile token — only required when TURNSTILE_SECRET_KEY is set.
  turnstileToken: z.string().optional(),
});

router.post('/contact', contactLimiter, async (req, res, next) => {
  try {
    // Honeypot pre-check — done before parsing so a bot's payload that looks
    // otherwise valid still gets a 200 with no email sent.
    if (typeof req.body?.website === 'string' && req.body.website.length > 0) {
      return res.json({ ok: true });
    }
    const data = contactSchema.parse(req.body);

    const turnstileOk = await verifyTurnstile(data.turnstileToken, req.ip);
    if (!turnstileOk) {
      return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    }

    await sendInquiryEmail({
      name: data.name,
      email: data.email,
      phone: data.phone ?? undefined,
      message: data.message,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ----- Public self-serve signup -----
//
// Richer contact form that creates a Lead row alongside the inquiry email
// so the sales workflow stays inside the portal. Same honeypot + turnstile
// + rate-limiting story as /contact. We don't create a User account here:
// the customer becomes an actual portal user only when sales sends them an
// invite via the existing /admin/invitations flow.

const signupSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  scope: z.string().min(1).max(5000),
  estimatedBudgetCents: z.number().int().nonnegative().optional().nullable(),
  // Cosmetic — lets the customer say where they heard about us. Mapped
  // loosely onto LeadSource; freeform values fall back to OTHER.
  source: z.string().max(60).optional(),
  website: z.string().max(500).optional(),
  turnstileToken: z.string().optional(),
});

function mapLeadSource(raw: string | undefined): LeadSource {
  if (!raw) return LeadSource.WEBSITE_FORM;
  const upper = raw.trim().toUpperCase().replace(/[^A-Z_]/g, '_');
  if (upper in LeadSource) return upper as LeadSource;
  return LeadSource.WEBSITE_FORM;
}

router.post('/signup', contactLimiter, async (req, res, next) => {
  try {
    if (typeof req.body?.website === 'string' && req.body.website.length > 0) {
      return res.json({ ok: true });
    }
    const data = signupSchema.parse(req.body);

    const turnstileOk = await verifyTurnstile(data.turnstileToken, req.ip);
    if (!turnstileOk) {
      return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    }

    // Lead.createdBy is non-nullable but a public signup has no logged-in
    // author. Use the first active admin as the synthetic creator so leads
    // always have a valid FK; if none exists, fall back to any active user
    // (a fresh install with no admin is broken anyway).
    const seedUser = await prisma.user.findFirst({
      where: { role: Role.ADMIN, isActive: true },
      orderBy: { createdAt: 'asc' },
    }) ?? await prisma.user.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!seedUser) {
      return res.status(503).json({ error: 'System not initialized — please contact us directly.' });
    }

    await prisma.lead.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        address: data.address ?? null,
        scope: data.scope,
        estimatedValueCents: data.estimatedBudgetCents ?? null,
        status: LeadStatus.NEW,
        source: mapLeadSource(data.source),
        createdById: seedUser.id,
      },
    });

    // Also notify sales via the inquiry email so the existing notification
    // path stays warm. Lead row is the system of record; email is the nudge.
    await sendInquiryEmail({
      name: data.name,
      email: data.email,
      phone: data.phone ?? undefined,
      message: `New self-serve signup:\n\nScope:\n${data.scope}${data.address ? `\n\nAddress: ${data.address}` : ''}${data.estimatedBudgetCents ? `\n\nEstimated budget: $${(data.estimatedBudgetCents / 100).toFixed(2)}` : ''}\n\nLanded as a NEW lead in the portal.`,
    }).catch((err) => console.warn('[public:signup] inquiry email failed', err));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
