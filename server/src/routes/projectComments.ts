import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { canManageProject } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

const COMMENT_ROOT = path.resolve(process.cwd(), 'uploads', 'project-comments');

const upload = multer({
  storage: multer.memoryStorage(),
  // Keep file size modest — chat-style attachments, not full receipt scans.
  // The receipt route's 10 MB cap is generous for that flow; here we cap at
  // 8 MB to nudge users toward photos rather than uncompressed scans.
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

const createSchema = z.object({ body: z.string().max(5000).optional() });

interface AttachmentRecord {
  url: string;
  thumbnailUrl: string;
  filename: string;
}

router.get('/:id/comments', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me || !canManageProject(me, project).read) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const comments = await prisma.projectComment.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', upload.array('attachments', 5), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me || !canManageProject(me, project).read) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!data.body && files.length === 0) {
      return res.status(400).json({ error: 'Comment must have body text or attachments' });
    }

    // Persist attachments first so the comment row carries final URLs.
    const attachments: AttachmentRecord[] = [];
    if (files.length > 0) {
      // Use the comment id once we have it. Pre-compute a placeholder
      // directory keyed on a stamp; rename on success.
      const stamp = Date.now();
      const stagingDir = path.join(COMMENT_ROOT, `staging-${stamp}-${Math.random().toString(36).slice(2, 8)}`);
      await fs.mkdir(stagingDir, { recursive: true });

      for (const f of files) {
        const safeName = f.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const main = await sharp(f.buffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 84 })
          .toBuffer();
        const thumb = await sharp(f.buffer)
          .rotate()
          .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        const mainName = `${stamp}-${safeName}.webp`;
        const thumbName = `${stamp}-${safeName}-thumb.webp`;
        await fs.writeFile(path.join(stagingDir, mainName), main);
        await fs.writeFile(path.join(stagingDir, thumbName), thumb);
        attachments.push({
          url: '', // filled below once we know the comment id
          thumbnailUrl: '',
          filename: f.originalname,
        });
        // Track the on-disk names so we can rebuild URLs after move.
        (attachments[attachments.length - 1] as AttachmentRecord & { _main?: string; _thumb?: string })._main = mainName;
        (attachments[attachments.length - 1] as AttachmentRecord & { _main?: string; _thumb?: string })._thumb = thumbName;
      }

      const comment = await prisma.projectComment.create({
        data: {
          projectId: project.id,
          authorId: me.id,
          body: data.body ?? '',
          // attachments updated immediately after the rename below.
        },
      });
      const targetDir = path.join(COMMENT_ROOT, comment.id);
      await fs.rename(stagingDir, targetDir);
      const finalAttachments: AttachmentRecord[] = attachments.map((a) => {
        const ext = a as AttachmentRecord & { _main: string; _thumb: string };
        return {
          filename: a.filename,
          url: `/uploads/project-comments/${comment.id}/${ext._main}`,
          thumbnailUrl: `/uploads/project-comments/${comment.id}/${ext._thumb}`,
        };
      });
      const updated = await prisma.projectComment.update({
        where: { id: comment.id },
        // Cast to satisfy Prisma's JSON input type which expects a generic
        // JsonValue rather than our typed AttachmentRecord[].
        data: { attachments: finalAttachments as unknown as object },
        include: { author: { select: { id: true, name: true, role: true } } },
      });
      return res.status(201).json({ comment: updated });
    }

    const comment = await prisma.projectComment.create({
      data: { projectId: project.id, authorId: me.id, body: data.body ?? '' },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ comment });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/comments/:commentId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    const project = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const comment = await prisma.projectComment.findUnique({
      where: { id: req.params.commentId },
    });
    if (!comment || comment.projectId !== project.id) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    if (comment.authorId !== me.id && me.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await prisma.projectComment.delete({ where: { id: comment.id } });
    // Best-effort cleanup of the attachment directory.
    if (comment.attachments) {
      const dir = path.join(COMMENT_ROOT, comment.id);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
