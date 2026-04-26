import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Disk storage under uploads/projects/<id>/docs so we don't collide with
// images stored at uploads/projects/<id>/.
const DOC_ROOT = path.resolve(process.cwd(), 'uploads', 'projects');
const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(DOC_ROOT, req.params.id, 'docs');
      fsSync.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename(_req, file, cb) {
      const stamp = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${stamp}-${safe}`);
    },
  }),
  // 30 MB cap covers most architectural PDFs + scanned permits.
  limits: { fileSize: 30 * 1024 * 1024 },
});

async function loadProjectAccessible(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (role === Role.CUSTOMER && project.customerId !== userId) return null;
  if (role === Role.SUBCONTRACTOR) {
    const owns = await prisma.schedule.count({ where: { projectId, assigneeId: userId } });
    if (owns === 0) return null;
  }
  return project;
}

router.get('/:id/documents', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.id, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const where: { projectId: string; customerVisible?: boolean } = { projectId: project.id };
    // Customers only see customer-visible docs.
    if (req.user!.role === Role.CUSTOMER) where.customerVisible = true;
    const documents = await prisma.projectDocument.findMany({
      where,
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
      include: { uploadedBy: { select: { id: true, name: true, role: true } } },
    });
    res.json({ documents });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/documents',
  requireRole(Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR),
  upload.array('files', 8),
  async (req, res, next) => {
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } });
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const files = (req.files as Express.Multer.File[]) ?? [];
      if (files.length === 0) return res.status(400).json({ error: 'No files received' });

      const category = typeof req.body.category === 'string' && req.body.category.trim()
        ? req.body.category.trim().slice(0, 60)
        : null;
      const description = typeof req.body.description === 'string' && req.body.description.trim()
        ? req.body.description.trim().slice(0, 400)
        : null;
      // 'true' / '1' → true. Default true.
      const customerVisible = req.body.customerVisible === undefined
        ? true
        : ['true', '1', 'on'].includes(String(req.body.customerVisible).toLowerCase());

      const records = await prisma.$transaction(
        files.map((f) =>
          prisma.projectDocument.create({
            data: {
              projectId: project.id,
              uploadedById: req.user!.sub,
              filename: f.originalname,
              url: `/uploads/projects/${project.id}/docs/${f.filename}`,
              contentType: f.mimetype,
              sizeBytes: f.size,
              category,
              description,
              customerVisible,
            },
            include: { uploadedBy: { select: { id: true, name: true, role: true } } },
          }),
        ),
      );
      res.status(201).json({ documents: records });
    } catch (err) {
      next(err);
    }
  },
);

const patchSchema = z.object({
  category: z.string().max(60).nullable().optional(),
  description: z.string().max(400).nullable().optional(),
  customerVisible: z.boolean().optional(),
});

router.patch(
  '/:id/documents/:documentId',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const data = patchSchema.parse(req.body);
      const doc = await prisma.projectDocument.findUnique({ where: { id: req.params.documentId } });
      if (!doc || doc.projectId !== req.params.id) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const updated = await prisma.projectDocument.update({
        where: { id: doc.id },
        data: {
          category: data.category === null ? null : data.category,
          description: data.description === null ? null : data.description,
          customerVisible: data.customerVisible,
        },
      });
      res.json({ document: updated });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:id/documents/:documentId',
  requireRole(Role.ADMIN, Role.EMPLOYEE),
  async (req, res, next) => {
    try {
      const doc = await prisma.projectDocument.findUnique({ where: { id: req.params.documentId } });
      if (!doc || doc.projectId !== req.params.id) {
        return res.status(404).json({ error: 'Document not found' });
      }
      await prisma.projectDocument.delete({ where: { id: doc.id } });
      const filePath = path.join(process.cwd(), doc.url.replace(/^\/+/, ''));
      await fs.unlink(filePath).catch(() => undefined);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
