import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createStorage } from '../lib/storage.js';

const router = Router();
router.use(requireAuth);

const storage = createStorage();

const upload = multer({
  storage: storage.engine,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB cap
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

async function loadProjectAccessible(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (role === Role.CUSTOMER && project.customerId !== userId) return null;
  return project;
}

router.get('/:id/images', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.id, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const images = await prisma.projectImage.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true, role: true } } },
    });
    res.json({ images });
  } catch (err) {
    next(err);
  }
});

// Chronological timeline grouped by year-month, oldest first. Each image
// carries a resolved `at` (takenAt ?? createdAt) so the client doesn't have
// to reapply that fallback. Also surfaces a phase-summary count so the UI
// can render quick filters without a second round-trip.
router.get('/:id/images/timeline', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.id, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const images = await prisma.projectImage.findMany({
      where: { projectId: project.id },
      orderBy: [{ takenAt: 'asc' }, { createdAt: 'asc' }],
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    type Decorated = (typeof images)[number] & { at: Date };
    const decorated: Decorated[] = images.map((img) => ({ ...img, at: img.takenAt ?? img.createdAt }));

    // Bucket by YYYY-MM. Insertion order is the iteration order so we end
    // up with months oldest → newest.
    const groups = new Map<string, Decorated[]>();
    for (const img of decorated) {
      const key = `${img.at.getUTCFullYear()}-${String(img.at.getUTCMonth() + 1).padStart(2, '0')}`;
      const arr = groups.get(key) ?? [];
      arr.push(img);
      groups.set(key, arr);
    }

    // Phase counts (case-sensitive — matches what was stored).
    const phaseCounts: Record<string, number> = {};
    for (const img of decorated) {
      const k = img.phase ?? '__unphased__';
      phaseCounts[k] = (phaseCounts[k] ?? 0) + 1;
    }

    res.json({
      months: [...groups.entries()].map(([month, items]) => ({ month, items })),
      total: images.length,
      phaseCounts,
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  caption: z.string().max(500).nullable().optional(),
  phase: z.string().max(40).nullable().optional(),
  takenAt: z.string().datetime().nullable().optional(),
});

router.patch(
  '/:id/images/:imageId',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const data = patchSchema.parse(req.body);
      const image = await prisma.projectImage.findUnique({ where: { id: req.params.imageId } });
      if (!image || image.projectId !== req.params.id) {
        return res.status(404).json({ error: 'Image not found' });
      }
      const updated = await prisma.projectImage.update({
        where: { id: image.id },
        data: {
          caption: data.caption === undefined ? undefined : data.caption,
          phase: data.phase === undefined ? undefined : data.phase,
          takenAt:
            data.takenAt === undefined
              ? undefined
              : data.takenAt === null
                ? null
                : new Date(data.takenAt),
        },
      });
      res.json({ image: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/:id/images',
  requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR),
  upload.array('files', 12),
  async (req, res, next) => {
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const files = (req.files as Array<Express.Multer.File & { key?: string }>) ?? [];
      const caption = typeof req.body.caption === 'string' ? req.body.caption : undefined;
      const phase = typeof req.body.phase === 'string' && req.body.phase.trim()
        ? req.body.phase.trim().slice(0, 40)
        : null;
      // takenAt may be a YYYY-MM-DD or full ISO string; both parse via Date.
      const takenAt = typeof req.body.takenAt === 'string' && req.body.takenAt
        ? new Date(req.body.takenAt)
        : null;

      // Generate thumbnails sequentially so a single big image doesn't peg the
      // event loop. Failures are non-fatal — we fall back to no thumbnail.
      const records: Array<{
        filename: string;
        originalName: string;
        url: string;
        thumbnailUrl: string | null;
      }> = [];

      for (const f of files) {
        // disk storage exposes filename; multer-s3 exposes key — handle both.
        const filename =
          (f as Express.Multer.File).filename ?? f.key?.split('/').pop() ?? f.originalname;
        const url = storage.publicUrl(project.id, filename);

        let thumbnailUrl: string | null = null;
        try {
          const source = (f as Express.Multer.File).path
            ? await fs.readFile((f as Express.Multer.File).path)
            : (f.buffer as Buffer | undefined);
          if (source) {
            const thumb = await sharp(source)
              .rotate()
              .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 78 })
              .toBuffer();
            const thumbName = `thumb-${path.parse(filename).name}.webp`;
            thumbnailUrl = await storage.putDerived(project.id, thumbName, thumb);
          }
        } catch (thumbErr) {
          console.warn('[upload] thumbnail generation failed', thumbErr);
        }

        records.push({ filename, originalName: f.originalname, url, thumbnailUrl });
      }

      const created = await prisma.$transaction(
        records.map((r) =>
          prisma.projectImage.create({
            data: {
              projectId: project.id,
              uploadedById: req.user!.sub,
              filename: r.originalName,
              url: r.url,
              thumbnailUrl: r.thumbnailUrl,
              caption,
              phase,
              takenAt: takenAt && !Number.isNaN(takenAt.valueOf()) ? takenAt : null,
            },
          }),
        ),
      );
      res.status(201).json({ images: created });
    } catch (err) {
      next(err);
    }
  },
);

const deleteParams = z.object({ imageId: z.string() });

router.delete(
  '/:id/images/:imageId',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const { imageId } = deleteParams.parse(req.params);
      const image = await prisma.projectImage.findUnique({ where: { id: imageId } });
      if (!image || image.projectId !== req.params.id) {
        return res.status(404).json({ error: 'Image not found' });
      }
      await prisma.projectImage.delete({ where: { id: imageId } });
      await storage.remove(image.url);
      if (image.thumbnailUrl) await storage.remove(image.thumbnailUrl);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
