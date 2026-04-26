import { Router } from 'express';
import { z } from 'zod';
import { PunchListStatus, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

// Customer can read + sign off / reopen on their own project. Subs only see
// punch lists for projects they're scheduled on. Staff see everything.
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

router.get('/:projectId/punch-list', async (req, res, next) => {
  try {
    const project = await loadProjectAccessible(req.params.projectId, req.user!.sub, req.user!.role);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const items = await prisma.punchListItem.findMany({
      where: { projectId: project.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { createdBy: { select: { id: true, name: true } } },
    });
    res.json({ items });
  } catch (err) { next(err); }
});

const createSchema = z.object({
  description: z.string().min(1).max(500),
  notes: z.string().max(2000).nullable().optional(),
  area: z.string().max(80).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  status: z.nativeEnum(PunchListStatus).optional(),
});

router.post('/:projectId/punch-list', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (me.role === Role.CUSTOMER || me.role === Role.SUBCONTRACTOR) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const data = createSchema.parse(req.body);
    // Default position to end-of-list so new items append.
    const last = await prisma.punchListItem.findFirst({
      where: { projectId: project.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const item = await prisma.punchListItem.create({
      data: {
        projectId: project.id,
        description: data.description,
        notes: data.notes ?? null,
        area: data.area ?? null,
        position: data.position ?? (last ? last.position + 1 : 0),
        status: data.status ?? PunchListStatus.OPEN,
        createdById: me.id,
      },
    });
    res.status(201).json({ item });
  } catch (err) { next(err); }
});

const patchSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).nullable().optional(),
  area: z.string().max(80).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  // Staff can flip status to OPEN / READY_FOR_REVIEW. Customer signoff goes
  // through /sign and /reopen below to capture the IP + signature.
  status: z.enum([PunchListStatus.OPEN, PunchListStatus.READY_FOR_REVIEW]).optional(),
});

router.patch('/:projectId/punch-list/:itemId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (me.role === Role.CUSTOMER || me.role === Role.SUBCONTRACTOR) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const data = patchSchema.parse(req.body);
    const existing = await prisma.punchListItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing || existing.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = await prisma.punchListItem.update({
      where: { id: existing.id },
      data: {
        description: data.description,
        notes: data.notes === null ? null : data.notes,
        area: data.area === null ? null : data.area,
        position: data.position,
        status: data.status,
      },
    });
    res.json({ item });
  } catch (err) { next(err); }
});

router.delete('/:projectId/punch-list/:itemId', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me) return res.status(401).json({ error: 'Unauthenticated' });
    if (me.role === Role.CUSTOMER || me.role === Role.SUBCONTRACTOR) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const existing = await prisma.punchListItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing || existing.projectId !== req.params.projectId) {
      return res.status(404).json({ error: 'Item not found' });
    }
    await prisma.punchListItem.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

const signSchema = z.object({ signatureName: z.string().min(1).max(160) });

// Customer signs off on a single item.
router.post('/:projectId/punch-list/:itemId/sign', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    if (role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only the customer can sign off on a punch-list item' });
    }
    const data = signSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!project || project.customerId !== sub) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const existing = await prisma.punchListItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing || existing.projectId !== project.id) {
      return res.status(404).json({ error: 'Item not found' });
    }
    if (existing.status !== PunchListStatus.READY_FOR_REVIEW && existing.status !== PunchListStatus.REOPENED) {
      return res.status(409).json({ error: 'Staff must mark the item ready for review first' });
    }
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim()
      ?? req.socket.remoteAddress
      ?? null;
    const item = await prisma.punchListItem.update({
      where: { id: existing.id },
      data: {
        status: PunchListStatus.DONE,
        signedAt: new Date(),
        signatureName: data.signatureName,
        signatureIp: ip,
        // Clear any prior reopen reason once the customer signs.
        reopenedAt: null,
        reopenReason: null,
      },
    });
    audit(req, {
      action: 'punchList.signed',
      resourceType: 'project',
      resourceId: project.id,
      meta: { itemId: existing.id, signatureName: data.signatureName },
    }).catch(() => undefined);
    res.json({ item });
  } catch (err) { next(err); }
});

const reopenSchema = z.object({ reason: z.string().max(2000).nullable().optional() });

router.post('/:projectId/punch-list/:itemId/reopen', async (req, res, next) => {
  try {
    const { sub, role } = req.user!;
    if (role !== Role.CUSTOMER) {
      return res.status(403).json({ error: 'Only the customer can reopen a punch-list item' });
    }
    const data = reopenSchema.parse(req.body);
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
    if (!project || project.customerId !== sub) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const existing = await prisma.punchListItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing || existing.projectId !== project.id) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = await prisma.punchListItem.update({
      where: { id: existing.id },
      data: {
        status: PunchListStatus.REOPENED,
        reopenedAt: new Date(),
        reopenReason: data.reason ?? null,
        // Clear any signature so staff can see the item is no longer signed.
        signedAt: null,
        signatureName: null,
        signatureIp: null,
      },
    });
    res.json({ item });
  } catch (err) { next(err); }
});

export default router;
