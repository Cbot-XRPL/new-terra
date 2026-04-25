import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function isStaff(role: Role) {
  return role === Role.ADMIN || role === Role.EMPLOYEE || role === Role.SUBCONTRACTOR;
}

const sendSchema = z.object({
  toUserId: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().min(1),
});

const otherPartyQuery = z.object({ with: z.string().min(1) });

// List threads — group messages by the other party and return latest preview.
router.get('/threads', async (req, res, next) => {
  try {
    const { sub } = req.user!;
    const messages = await prisma.message.findMany({
      where: { OR: [{ fromUserId: sub }, { toUserId: sub }] },
      orderBy: { createdAt: 'desc' },
      include: {
        fromUser: { select: { id: true, name: true, role: true } },
        toUser: { select: { id: true, name: true, role: true } },
      },
    });

    type Thread = {
      otherUser: { id: string; name: string; role: Role };
      latest: { id: string; body: string; createdAt: Date; fromMe: boolean };
      unread: number;
    };
    const threads = new Map<string, Thread>();

    for (const m of messages) {
      const otherUser = m.fromUserId === sub ? m.toUser : m.fromUser;
      const fromMe = m.fromUserId === sub;
      let t = threads.get(otherUser.id);
      if (!t) {
        t = {
          otherUser,
          latest: { id: m.id, body: m.body, createdAt: m.createdAt, fromMe },
          unread: 0,
        };
        threads.set(otherUser.id, t);
      }
      if (!fromMe && !m.readAt) t.unread += 1;
    }

    res.json({ threads: [...threads.values()] });
  } catch (err) {
    next(err);
  }
});

// Conversation with one other user, oldest first.
router.get('/conversation', async (req, res, next) => {
  try {
    const { with: otherId } = otherPartyQuery.parse(req.query);
    const { sub } = req.user!;

    const other = await prisma.user.findUnique({ where: { id: otherId } });
    if (!other) return res.status(404).json({ error: 'User not found' });

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { fromUserId: sub, toUserId: otherId },
          { fromUserId: otherId, toUserId: sub },
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: { fromUser: { select: { id: true, name: true, role: true } } },
    });

    // Mark inbound messages as read on view.
    await prisma.message.updateMany({
      where: { fromUserId: otherId, toUserId: sub, readAt: null },
      data: { readAt: new Date() },
    });

    res.json({
      conversation: {
        otherUser: { id: other.id, name: other.name, role: other.role },
        messages,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = sendSchema.parse(req.body);
    const sender = req.user!;
    if (data.toUserId === sender.sub) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }
    const recipient = await prisma.user.findUnique({ where: { id: data.toUserId } });
    if (!recipient || !recipient.isActive) {
      return res.status(404).json({ error: 'Recipient not found' });
    }
    // Customers can only message staff; staff can message anyone.
    if (sender.role === Role.CUSTOMER && !isStaff(recipient.role)) {
      return res.status(403).json({ error: 'Customers can only message staff' });
    }

    const message = await prisma.message.create({
      data: {
        fromUserId: sender.sub,
        toUserId: recipient.id,
        subject: data.subject,
        body: data.body,
      },
      include: { fromUser: { select: { id: true, name: true, role: true } } },
    });
    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
});

// Recipients the current user is allowed to message:
// - staff: all active customers (and other staff)
// - customer: all active staff
router.get('/recipients', async (req, res, next) => {
  try {
    const { role } = req.user!;
    const where = isStaff(role)
      ? { isActive: true, NOT: { id: req.user!.sub } }
      : { isActive: true, role: { in: [Role.ADMIN, Role.EMPLOYEE, Role.SUBCONTRACTOR] } };
    const users = await prisma.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, role: true },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// Lightweight unread counter for nav badges.
router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await prisma.message.count({
      where: { toUserId: req.user!.sub, readAt: null },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

export default router;
