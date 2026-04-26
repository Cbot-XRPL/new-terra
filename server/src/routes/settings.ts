import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { getCompanySettings } from '../lib/companySettings.js';

const router = Router();
router.use(requireAuth);

// Anyone authenticated can read settings — we expose the same payload to
// customers (so the "How to pay us" panel renders) and staff. Sensitive
// secrets do NOT belong in this table; treat it as public-to-the-portal.
router.get('/', async (_req, res, next) => {
  try {
    const s = await getCompanySettings();
    res.json({ settings: s });
  } catch (err) {
    next(err);
  }
});

const settingsSchema = z.object({
  companyName: z.string().max(120).nullable().optional(),
  legalName: z.string().max(160).nullable().optional(),
  taxId: z.string().max(40).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(160).nullable().optional(),
  websiteUrl: z.string().url().max(300).nullable().optional(),
  addressLine1: z.string().max(160).nullable().optional(),
  addressLine2: z.string().max(160).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().max(40).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  zelleEmail: z.string().email().max(160).nullable().optional(),
  zelleName: z.string().max(120).nullable().optional(),
  zellePhone: z.string().max(40).nullable().optional(),
  achInstructions: z.string().max(2000).nullable().optional(),
  checkPayableTo: z.string().max(160).nullable().optional(),
  checkMailingAddress: z.string().max(400).nullable().optional(),
  paymentNotes: z.string().max(2000).nullable().optional(),
});

router.patch('/', requireRole(Role.ADMIN), async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    const updated = await prisma.companySettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    audit(req, {
      action: 'settings.updated',
      resourceType: 'companySettings',
      resourceId: 'default',
      meta: { keys: Object.keys(data) },
    }).catch(() => undefined);
    res.json({ settings: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
