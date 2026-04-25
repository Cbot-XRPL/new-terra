import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'projects');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = path.join(UPLOAD_ROOT, req.params.id);
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(_req, file, cb) {
    const stamp = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${stamp}-${safe}`);
  },
});

const upload = multer({
  storage,
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

      const files = (req.files as Express.Multer.File[]) ?? [];
      const caption = typeof req.body.caption === 'string' ? req.body.caption : undefined;

      const created = await prisma.$transaction(
        files.map((f) =>
          prisma.projectImage.create({
            data: {
              projectId: project.id,
              uploadedById: req.user!.sub,
              filename: f.originalname,
              url: `/uploads/projects/${project.id}/${path.basename(f.path)}`,
              caption,
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

      // Best-effort delete from disk; missing files are not an error.
      const filePath = path.join(process.cwd(), image.url.replace(/^\/+/, ''));
      fs.unlink(filePath, () => {});

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
