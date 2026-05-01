import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  generateInviteToken,
  hashInviteToken,
  hashPassword,
  signJwt,
  verifyPassword,
} from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { env } from '../env.js';
import { linkPreviousLeadDataToCustomer } from '../lib/leadLinking.js';
import { ensureContractorCatalogItem } from '../lib/contractorCatalog.js';
import { Role } from '@prisma/client';
import {
  SIGN_IN_SCOPES,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  isConfigured as isGoogleConfigured,
  loginRedirectUri,
  signState,
  verifyState,
} from '../lib/googleOauth.js';

const router = Router();

// Throttle login attempts to slow down credential-stuffing. 10 attempts per
// IP per 15 minutes is generous for humans but breaks tool-driven brute force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Accept-invite gets the same treatment — somebody scraping invite tokens
// shouldn't get unlimited tries.
const acceptInviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Reset request is the most-spammable endpoint (anyone can poke it). Tight
// per-IP limit; the per-account abuse case is already mitigated because
// generating a fresh token invalidates older un-used ones.
const resetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again later.' },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Public self-signup. Creates a CUSTOMER user from scratch, OR claims an
// existing pre-seeded customer record (sales rep created the row but it
// has no passwordHash yet). Throttled hard so it can't be used to enumerate
// existing accounts.
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  // Self-signup is open to customers and subcontractors. Employees and
  // admins still need an invitation. Default to CUSTOMER for the older
  // payload shape that didn't include role.
  role: z.enum(['CUSTOMER', 'SUBCONTRACTOR']).default('CUSTOMER'),
  // Free-form trade label for SUBCONTRACTOR signup (Framing, Plumbing, …).
  tradeType: z.string().max(60).optional().nullable(),
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash || !user.isActive) {
      // Audit failed login (only when an account exists) so abuse trails are
      // visible without leaking which emails are valid.
      if (user) {
        audit(req, {
          action: 'auth.login_failed',
          resourceType: 'user',
          resourceId: user.id,
          meta: { reason: !user.passwordHash ? 'no_password' : 'inactive' },
        }).catch(() => undefined);
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      audit(req, {
        action: 'auth.login_failed',
        resourceType: 'user',
        resourceId: user.id,
        meta: { reason: 'bad_password' },
      }).catch(() => undefined);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signJwt({
      sub: user.id,
      role: user.role,
      email: user.email,
      tv: user.tokenVersion,
    });

    // Back-fill any leads/estimates that the sales team has been drafting
    // under this email since the customer last logged in. Idempotent
    // (no-op when there's nothing pending) so it's safe on every login.
    if (user.role === Role.CUSTOMER) {
      prisma
        .$transaction((tx) => linkPreviousLeadDataToCustomer(tx, user.email, user.id))
        .catch((err) => console.warn('[auth:login] back-fill failed', err));
    }

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSales: user.isSales,
        isProjectManager: user.isProjectManager,
        isAccounting: user.isAccounting,
        avatarUrl: user.avatarUrl,
        avatarThumbnailUrl: user.avatarThumbnailUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Public self-signup. Three branches:
//   1) Email is unknown — create a fresh CUSTOMER user.
//   2) Email matches a pre-seeded CUSTOMER (no passwordHash yet) — let the
//      visitor "claim" the account by setting a password. This is the
//      common path: a sales rep added them as a lead, converted, and the
//      customer is signing up directly instead of using the invite link.
//   3) Email matches anything else (existing-active customer, employee,
//      admin, subcontractor) — refuse and tell them to sign in / use the
//      proper invite. Self-signup must never claim a non-CUSTOMER role.
//
// In every successful branch we run linkPreviousLeadDataToCustomer so any
// leads/estimates drafted under this email auto-attach to the new account.
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { email, name, password, phone, role, tradeType } = registerSchema.parse(req.body);
    const normalisedEmail = email.toLowerCase();
    const wantedRole = role === 'SUBCONTRACTOR' ? Role.SUBCONTRACTOR : Role.CUSTOMER;
    const existing = await prisma.user.findUnique({ where: { email: normalisedEmail } });

    if (existing && existing.passwordHash) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please sign in instead.',
      });
    }
    if (existing && existing.role !== wantedRole) {
      // The pre-seeded record's role doesn't match what the visitor is
      // signing up as. Don't silently change roles — bail out and ask
      // them to reach out so an admin can sort it. Also covers the
      // privilege-escalation hole (a visitor cannot self-promote into
      // ADMIN/EMPLOYEE by registering against a pre-seeded employee row).
      return res.status(409).json({
        error: 'This email is reserved for a different account type. Please contact us to sort it out.',
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const upserted = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              name,
              phone: phone ?? existing.phone,
              tradeType: wantedRole === Role.SUBCONTRACTOR ? (tradeType ?? existing.tradeType) : existing.tradeType,
              isActive: true,
            },
          })
        : await tx.user.create({
            data: {
              email: normalisedEmail,
              name,
              phone: phone ?? null,
              role: wantedRole,
              passwordHash,
              tradeType: wantedRole === Role.SUBCONTRACTOR ? (tradeType ?? null) : null,
            },
          });
      // Lead/estimate back-fill is customer-only — contractors don't have
      // leads-as-prospects in this product.
      if (upserted.role === Role.CUSTOMER) {
        await linkPreviousLeadDataToCustomer(tx, upserted.email, upserted.id);
      }
      // Subcontractor self-signup: spin up their labor catalog item so
      // sales can drop them onto an estimate immediately.
      await ensureContractorCatalogItem(tx, upserted);
      return upserted;
    });

    const jwtToken = signJwt({
      sub: user.id,
      role: user.role,
      email: user.email,
      tv: user.tokenVersion,
    });
    res.status(201).json({
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSales: user.isSales,
        isProjectManager: user.isProjectManager,
        isAccounting: user.isAccounting,
        avatarUrl: user.avatarUrl,
        avatarThumbnailUrl: user.avatarThumbnailUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        isSales: true,
        isProjectManager: true,
        isAccounting: true,
        billingMode: true,
        dailyRateCents: true,
        hourlyRateCents: true,
        avatarUrl: true,
        avatarThumbnailUrl: true,
        driversLicenseUrl: true,
        contractorLicenseUrl: true,
        businessLicenseUrl: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

const acceptSchema = z.object({
  token: z.string().min(20),
  name: z.string().min(1),
  password: z.string().min(8),
  phone: z.string().optional(),
});

router.post('/accept-invite', acceptInviteLimiter, async (req, res, next) => {
  try {
    const { token, name, password, phone } = acceptSchema.parse(req.body);
    const tokenHash = hashInviteToken(token);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation is invalid or expired' });
    }

    const existing = await prisma.user.findUnique({ where: { email: invite.email.toLowerCase() } });
    if (existing && existing.passwordHash) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      // If a pre-seeded row exists (admin invited from /portal/admin and
      // pre-filled name + flags), claim it in place — keep the role,
      // sub-flags, tradeType, etc., and only overwrite what the invitee
      // is providing now (name, phone, password).
      const upserted = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              passwordHash,
              name,
              phone: phone ?? existing.phone,
              isActive: true,
            },
          })
        : await tx.user.create({
            data: {
              email: invite.email.toLowerCase(),
              name,
              phone,
              role: invite.role,
              passwordHash,
            },
          });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      // Auto-link any previous lead-attached data (estimates, lead row,
      // future-comms) to this brand-new customer so their portal "just
      // works" — they see what the sales rep has been drafting under
      // their email without anyone re-attaching by hand.
      if (invite.role === Role.CUSTOMER) {
        await linkPreviousLeadDataToCustomer(tx, upserted.email, upserted.id);
      }
      // Sync the catalog mirror so admin's name update / phone update
      // doesn't desync the labor product. No-op for customer/admin.
      await ensureContractorCatalogItem(tx, upserted);
      return upserted;
    });

    const jwtToken = signJwt({
      sub: user.id,
      role: user.role,
      email: user.email,
      tv: user.tokenVersion,
    });
    res.json({
      token: jwtToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSales: user.isSales,
        isProjectManager: user.isProjectManager,
        isAccounting: user.isAccounting,
        avatarUrl: user.avatarUrl,
        avatarThumbnailUrl: user.avatarThumbnailUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Public endpoint to check whether an invite token is still valid (used by the
// accept-invite page to show the email + role before the user sets a password).
router.get('/invite/:token', async (req, res, next) => {
  try {
    const tokenHash = hashInviteToken(req.params.token);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return res.status(404).json({ error: 'Invitation is invalid or expired' });
    }
    res.json({ email: invite.email, role: invite.role });
  } catch (err) {
    next(err);
  }
});

// ---- Password reset ----

const RESET_TTL_MIN = 60;

const requestResetSchema = z.object({ email: z.string().email() });

// Always returns 200 to avoid leaking which emails are registered. Real
// users get an email; bogus addresses get nothing.
router.post('/request-password-reset', resetRequestLimiter, async (req, res, next) => {
  try {
    const { email } = requestResetSchema.parse(req.body);
    const normalized = email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (user && user.isActive) {
      // Invalidate any prior un-used tokens — only the latest works.
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      });
      const { token, tokenHash } = generateInviteToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60 * 1000),
        },
      });
      const resetUrl = `${env.appUrl}/reset-password?token=${token}`;
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        ttlMinutes: RESET_TTL_MIN,
      }).catch((err) => console.warn('[auth] reset email failed', err));
      audit(req, {
        action: 'auth.password_reset_requested',
        resourceType: 'user',
        resourceId: user.id,
      }).catch(() => undefined);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

router.post('/reset-password', acceptInviteLimiter, async (req, res, next) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const tokenHash = hashInviteToken(token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }
    if (!record.user.isActive) {
      return res.status(400).json({ error: 'Account is no longer active' });
    }
    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        // Bump tokenVersion so any sessions logged in with the old password
        // are invalidated immediately. Defence against the "I think someone
        // got my laptop" reset flow.
        data: { passwordHash, tokenVersion: { increment: 1 } },
      }),
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Burn any other outstanding tokens so a stolen one doesn't get
      // reused after the legitimate reset.
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
    ]);
    audit(req, {
      action: 'auth.password_reset_completed',
      resourceType: 'user',
      resourceId: record.userId,
    }).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Sign out everywhere — bumps tokenVersion so every issued JWT for this
// user is rejected at the auth middleware. Useful when a user thinks their
// account was compromised; admin can also call this on a user via /admin
// once we wire that up.
router.post('/sign-out-everywhere', requireAuth, async (req, res, next) => {
  try {
    const updated = await prisma.user.update({
      where: { id: req.user!.sub },
      data: { tokenVersion: { increment: 1 } },
      select: { tokenVersion: true },
    });
    audit(req, {
      action: 'auth.sign_out_everywhere',
      resourceType: 'user',
      resourceId: req.user!.sub,
      meta: { newTokenVersion: updated.tokenVersion },
    }).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Lookup endpoint for the reset page so we can show the user's name before
// they type a new password (mirrors /invite/:token UX).
router.get('/reset-token/:token', async (req, res, next) => {
  try {
    const tokenHash = hashInviteToken(req.params.token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { email: true, name: true, isActive: true } } },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
      return res.status(404).json({ error: 'Reset link is invalid or expired' });
    }
    res.json({ email: record.user.email, name: record.user.name });
  } catch (err) {
    next(err);
  }
});

// ─── Sign in with Google ────────────────────────────────────────────
//
// Two endpoints:
//   GET /api/auth/google/start    → returns the Google authorize URL
//                                   (client follows it as a top-level
//                                   navigation; we don't redirect from
//                                   the API so CORS stays clean).
//   GET /api/auth/google/callback → Google redirects here with `code`
//                                   + `state`. We exchange, find/create
//                                   the user, mint our JWT, and bounce
//                                   back to the SPA at /login?google_token=...
//                                   so the client can pluck the token,
//                                   stash it, and route into /portal.

router.get('/google/start', (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({ error: 'Google sign-in is not configured.' });
  }
  const state = signState({ kind: 'login' });
  const url = buildAuthorizeUrl({
    redirectUri: loginRedirectUri(),
    scope: SIGN_IN_SCOPES,
    state,
  });
  res.json({ url });
});

router.get('/google/callback', async (req, res, next) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    if (!code || !state) {
      return res.redirect(`${env.appUrl}/login?google_error=missing_params`);
    }
    try {
      verifyState(state, 'login');
    } catch {
      return res.redirect(`${env.appUrl}/login?google_error=bad_state`);
    }
    const tokens = await exchangeCode({ code, redirectUri: loginRedirectUri() });
    const profile = await fetchUserInfo(tokens.access_token);

    if (!profile.email_verified) {
      return res.redirect(`${env.appUrl}/login?google_error=email_unverified`);
    }
    const email = profile.email.toLowerCase();

    // Match by stable Google sub first, then fall back to email so an
    // existing portal user (who hasn't connected Google yet) gets
    // linked rather than duplicated. Refuse if the email maps to a
    // disabled account.
    let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // Existing email-based account — attach the Google ID.
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId: profile.sub },
        });
      }
    }

    // Don't auto-create accounts on Google sign-in. The portal is
    // invite-only; if the email isn't already provisioned we send the
    // user back to login with a friendly hint instead of silently
    // creating a Customer-role record.
    if (!user) {
      return res.redirect(`${env.appUrl}/login?google_error=no_account`);
    }
    if (!user.isActive) {
      return res.redirect(`${env.appUrl}/login?google_error=account_disabled`);
    }

    const token = signJwt({
      sub: user.id,
      role: user.role,
      email: user.email,
      tv: user.tokenVersion,
    });
    await audit(req, {
      action: 'auth.google.login',
      resourceType: 'User',
      resourceId: user.id,
    });
    // Bounce back to the SPA's /login route — it has the logic to
    // pluck google_token from the URL, save it, and navigate to
    // /portal. Using a fragment instead of a query keeps the token
    // out of the server access logs.
    return res.redirect(`${env.appUrl}/login#google_token=${encodeURIComponent(token)}`);
  } catch (err) {
    next(err);
  }
});

export default router;
