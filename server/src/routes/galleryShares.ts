import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---------- Public (unauthenticated) read ----------
//
// Mounted at /api/public/gallery/:token — no auth required. Resolves the
// token, checks the share isn't revoked or expired, bumps view count,
// and returns photos + a thin slice of project info (name + customer
// first name only — we don't leak business contact info on a forwarded
// link).

router.get('/public/gallery/:token', async (req, res, next) => {
  try {
    const tokenHash = hashToken(req.params.token);
    const share = await prisma.galleryShare.findUnique({
      where: { tokenHash },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            customer: { select: { name: true } },
            images: {
              orderBy: [{ takenAt: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                url: true,
                thumbnailUrl: true,
                filename: true,
                caption: true,
                phase: true,
                takenAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!share) return res.status(404).json({ error: 'Link not found' });
    if (share.revokedAt) return res.status(410).json({ error: 'Link revoked' });
    if (share.expiresAt < new Date()) return res.status(410).json({ error: 'Link expired' });

    await prisma.galleryShare.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });

    res.json({
      project: {
        name: share.project.name,
        // Show first name only on the public side — full name reads as a
        // privacy leak when the link gets forwarded around.
        customerFirstName: share.project.customer.name.split(/\s+/)[0],
      },
      images: share.project.images.map((i) => ({
        ...i,
        // Resolved 'at' fallback so the public page doesn't have to repeat
        // that logic.
        at: (i.takenAt ?? i.createdAt).toISOString(),
      })),
      label: share.label,
      expiresAt: share.expiresAt.toISOString(),
    });
  } catch (err) { next(err); }
});

// ---------- Authenticated management ----------

router.use(requireAuth);

async function loadProjectAccessible(projectId: string, userId: string, role: Role) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return null;
  if (role === Role.CUSTOMER && project.customerId !== userId) return null;
  if (role === Role.SUBCONTRACTOR) return null; // subs can't share
  return project;
}

router.get('/projects/:projectId/shares', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.projectId, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const shares = await prisma.galleryShare.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    res.json({ shares });
  } catch (err) { next(err); }
});

const createSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  // Days until expiry. Bounded so we don't hand out forever-links by
  // accident. Default 30 — typical "share with the family" horizon.
  expiresInDays: z.number().int().min(1).max(365).default(30),
});

router.post('/projects/:projectId/shares', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    const project = await loadProjectAccessible(req.params.projectId, me.id, me.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const data = createSchema.parse(req.body);
    // 32 random bytes, base64url-encoded → 43-char token. Plenty of entropy.
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000);

    const share = await prisma.galleryShare.create({
      data: {
        projectId: project.id,
        tokenHash,
        label: data.label ?? null,
        createdById: me.id,
        expiresAt,
      },
    });

    audit(req, {
      action: 'gallery.share_created',
      resourceType: 'project',
      resourceId: project.id,
      meta: { shareId: share.id, expiresInDays: data.expiresInDays },
    }).catch(() => undefined);

    // Token is returned exactly once on create — admin must copy it now.
    // Subsequent reads only see the hash.
    res.status(201).json({ share, token: rawToken });
  } catch (err) { next(err); }
});

router.post('/projects/:projectId/shares/:id/revoke', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.projectId, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const share = await prisma.galleryShare.findUnique({ where: { id: req.params.id } });
    if (!share || share.projectId !== project.id) {
      return res.status(404).json({ error: 'Share not found' });
    }
    const updated = await prisma.galleryShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date() },
    });
    res.json({ share: updated });
  } catch (err) { next(err); }
});

router.delete('/projects/:projectId/shares/:id', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.projectId, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const share = await prisma.galleryShare.findUnique({ where: { id: req.params.id } });
    if (!share || share.projectId !== project.id) {
      return res.status(404).json({ error: 'Share not found' });
    }
    await prisma.galleryShare.delete({ where: { id: share.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

export default router;
