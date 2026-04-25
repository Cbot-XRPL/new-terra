import { Router } from 'express';
import multer from 'multer';
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

      const created = await prisma.$transaction(
        files.map((f) => {
          // disk storage exposes filename; multer-s3 exposes key — handle both.
          const filename = (f as Express.Multer.File).filename ?? f.key?.split('/').pop() ?? f.originalname;
          return prisma.projectImage.create({
            data: {
              projectId: project.id,
              uploadedById: req.user!.sub,
              filename: f.originalname,
              url: storage.publicUrl(project.id, filename),
              caption,
            },
          });
        }),
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
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
