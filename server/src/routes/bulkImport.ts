import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateInviteToken } from '../lib/auth.js';
import { sendInviteEmail } from '../lib/mailer.js';
import { env } from '../env.js';

const router = Router();
router.use(requireAuth, requireRole(Role.ADMIN));

const rowSchema = z.object({
  email: z.string().email(),
  // Role is optional; defaults to CUSTOMER (the most common bulk-import case).
  role: z.nativeEnum(Role).optional(),
});

const importSchema = z.object({
  rows: z.array(rowSchema).min(1).max(500),
  // If true, also email each new invitee via the configured SMTP transport.
  // When SMTP isn't configured, dev fallback logs to the server console.
  sendEmails: z.boolean().default(false),
});

interface RowResult {
  email: string;
  role: Role;
  status: 'invited' | 'exists' | 'invitation_pending' | 'error';
  message?: string;
  inviteUrl?: string;
}

router.post('/invitations', async (req, res, next) => {
  try {
    const data = importSchema.parse(req.body);
    const results: RowResult[] = [];

    for (const row of data.rows) {
      const email = row.email.toLowerCase();
      const role = row.role ?? Role.CUSTOMER;
      try {
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
          results.push({ email, role, status: 'exists', message: 'User already exists' });
          continue;
        }
        const pending = await prisma.invitation.findFirst({
          where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
        });
        if (pending) {
          results.push({
            email,
            role,
            status: 'invitation_pending',
            message: 'Active invitation already on file',
          });
          continue;
        }

        const { token, tokenHash } = generateInviteToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await prisma.invitation.create({
          data: {
            email,
            role,
            tokenHash,
            expiresAt,
            invitedById: req.user!.sub,
          },
        });

        const inviteUrl = `${env.appUrl}/accept-invite?token=${token}`;
        if (data.sendEmails) {
          await sendInviteEmail(email, inviteUrl, role).catch((err) =>
            console.warn('[bulk:import] mail send failed for', email, err),
          );
        }
        results.push({
          email,
          role,
          status: 'invited',
          // Only echo the URL when no mail transport is configured so admins
          // can copy it manually; otherwise the link is in the invitee's inbox.
          inviteUrl: (env.resend.apiKey || env.smtp.host) ? undefined : inviteUrl,
        });
      } catch (err) {
        results.push({
          email,
          role,
          status: 'error',
          message: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }

    const summary = results.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    res.json({ summary, results });
  } catch (err) {
    next(err);
  }
});

export default router;
