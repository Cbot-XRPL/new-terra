// Lead + Estimate photo attachments. Sales rep snaps a photo on the
// initial walk-through; it carries forward when the lead converts to an
// estimate, and again when the estimate converts to a project (handled
// in the estimate-create + estimate-convert routes — this file is just
// the upload / list / delete plumbing for each model).

import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hasSalesAccess } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

const ATTACH_ROOT = path.resolve(process.cwd(), 'uploads', 'attachments');

// Accept only images. PDFs / other docs go through the project document
// flow — attachments here are visual context (job-site photos, sketches).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

async function processImage(buffer: Buffer): Promise<{ main: Buffer; thumb: Buffer }> {
  const main = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
  const thumb = await sharp(buffer)
    .rotate()
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  return { main, thumb };
}

// ─── Leads ─────────────────────────────────────────────────────────────

router.get('/leads/:id/attachments', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const attachments = await prisma.leadAttachment.findMany({
      where: { leadId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    res.json({ attachments });
  } catch (err) {
    next(err);
  }
});

router.post('/leads/:id/attachments', upload.single('file'), async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const dir = path.join(ATTACH_ROOT, 'leads', lead.id);
    await fs.mkdir(dir, { recursive: true });
    const stamp = Date.now();
    const mainName = `photo-${stamp}.webp`;
    const thumbName = `photo-${stamp}-thumb.webp`;
    const { main, thumb } = await processImage(req.file.buffer);
    await fs.writeFile(path.join(dir, mainName), main);
    await fs.writeFile(path.join(dir, thumbName), thumb);

    const created = await prisma.leadAttachment.create({
      data: {
        leadId: lead.id,
        uploadedById: me.id,
        filename: req.file.originalname,
        url: `/uploads/attachments/leads/${lead.id}/${mainName}`,
        thumbnailUrl: `/uploads/attachments/leads/${lead.id}/${thumbName}`,
        caption: typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 200) : null,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    res.status(201).json({ attachment: created });
  } catch (err) {
    next(err);
  }
});

router.delete('/leads/:leadId/attachments/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const attach = await prisma.leadAttachment.findUnique({ where: { id: req.params.id } });
    if (!attach || attach.leadId !== req.params.leadId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    await prisma.leadAttachment.delete({ where: { id: attach.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Estimates ─────────────────────────────────────────────────────────

router.get('/estimates/:id/attachments', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const estimate = await prisma.estimate.findUnique({ where: { id: req.params.id } });
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    // Customers can read attachments on their own estimates; staff broadly.
    const customerOk = me.role === Role.CUSTOMER && estimate.customerId === me.id;
    const staffOk = hasSalesAccess(me);
    if (!customerOk && !staffOk) return res.status(403).json({ error: 'Forbidden' });
    const attachments = await prisma.estimateAttachment.findMany({
      where: { estimateId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    res.json({ attachments });
  } catch (err) {
    next(err);
  }
});

router.post('/estimates/:id/attachments', upload.single('file'), async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const estimate = await prisma.estimate.findUnique({ where: { id: req.params.id } });
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const dir = path.join(ATTACH_ROOT, 'estimates', estimate.id);
    await fs.mkdir(dir, { recursive: true });
    const stamp = Date.now();
    const mainName = `photo-${stamp}.webp`;
    const thumbName = `photo-${stamp}-thumb.webp`;
    const { main, thumb } = await processImage(req.file.buffer);
    await fs.writeFile(path.join(dir, mainName), main);
    await fs.writeFile(path.join(dir, thumbName), thumb);

    const created = await prisma.estimateAttachment.create({
      data: {
        estimateId: estimate.id,
        uploadedById: me.id,
        filename: req.file.originalname,
        url: `/uploads/attachments/estimates/${estimate.id}/${mainName}`,
        thumbnailUrl: `/uploads/attachments/estimates/${estimate.id}/${thumbName}`,
        caption: typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 200) : null,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    res.status(201).json({ attachment: created });
  } catch (err) {
    next(err);
  }
});

router.delete('/estimates/:estimateId/attachments/:id', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasSalesAccess(me)) return res.status(403).json({ error: 'Forbidden' });
    const attach = await prisma.estimateAttachment.findUnique({ where: { id: req.params.id } });
    if (!attach || attach.estimateId !== req.params.estimateId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    await prisma.estimateAttachment.delete({ where: { id: attach.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
