import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const AVATAR_ROOT = path.resolve(process.cwd(), 'uploads', 'avatars');

// In-memory storage so sharp can resize without bouncing through disk first.
// 8 MB cap is generous for a profile picture; sharp will downsize anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

const profileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).nullable().optional(),
});

const meSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isSales: true,
  isProjectManager: true,
  avatarUrl: true,
  avatarThumbnailUrl: true,
} as const;

router.get('/profile', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: meSelect });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.patch('/profile', async (req, res, next) => {
  try {
    const data = profileSchema.parse(req.body);
    if (data.email) {
      const normalized = data.email.toLowerCase();
      // Check the email isn't already taken by someone else.
      const conflict = await prisma.user.findFirst({
        where: { email: normalized, NOT: { id: req.user!.sub } },
        select: { id: true },
      });
      if (conflict) return res.status(409).json({ error: 'That email is already in use' });
      data.email = normalized;
    }
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data,
      select: meSelect,
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

async function resetAvatarOnDisk(userId: string) {
  // Wipe any prior derivatives so the directory doesn't accumulate stale files
  // when a user re-uploads. Errors here are non-fatal — best effort.
  const dir = path.join(AVATAR_ROOT, userId);
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(entries.map((e) => fs.unlink(path.join(dir, e)).catch(() => undefined)));
  } catch {
    // Directory didn't exist; that's fine.
  }
}

router.post('/avatar', upload.single('file'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const userId = req.user!.sub;
    const dir = path.join(AVATAR_ROOT, userId);
    await fs.mkdir(dir, { recursive: true });
    await resetAvatarOnDisk(userId);

    // Resize + auto-rotate by EXIF; output as webp for ~3x smaller payloads.
    const stamp = Date.now();
    const mainName = `avatar-${stamp}.webp`;
    const thumbName = `avatar-${stamp}-thumb.webp`;

    const main = await sharp(file.buffer)
      .rotate()
      .resize({ width: 512, height: 512, fit: 'cover' })
      .webp({ quality: 86 })
      .toBuffer();
    const thumb = await sharp(file.buffer)
      .rotate()
      .resize({ width: 96, height: 96, fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    await fs.writeFile(path.join(dir, mainName), main);
    await fs.writeFile(path.join(dir, thumbName), thumb);

    const avatarUrl = `/uploads/avatars/${userId}/${mainName}`;
    const avatarThumbnailUrl = `/uploads/avatars/${userId}/${thumbName}`;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl, avatarThumbnailUrl },
      select: meSelect,
    });
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

router.delete('/avatar', async (req, res, next) => {
  try {
    const userId = req.user!.sub;
    await resetAvatarOnDisk(userId);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null, avatarThumbnailUrl: null },
      select: meSelect,
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
