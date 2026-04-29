// Shared attachment-upload pipeline for chat-style surfaces (project
// comments, message board, 1:1 messages). All three persist attachments as
// a JSON array on the parent row — same shape, different parent type.
//
// Storage layout: server/uploads/<bucket>/<parentId>/<stamped-filename>.webp
// (and a -thumb.webp sibling for image previews).

import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';

export interface AttachmentRecord {
  url: string;
  thumbnailUrl: string;
  filename: string;
}

export type AttachmentBucket = 'project-comments' | 'board' | 'messages';

const ROOT = path.resolve(process.cwd(), 'uploads');

// One multer instance covers all three buckets — they share the same caps
// and validation. Each route picks a bucket name and resolves the on-disk
// directory in `processFiles`.
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

/**
 * Persist multer-uploaded files to disk under uploads/<bucket>/<parentId>
 * and return the JSON-ready attachment records that should land on the
 * parent row. Caller is responsible for the DB write.
 *
 * Returns an empty array when no files were uploaded.
 */
export async function processAttachments(
  bucket: AttachmentBucket,
  parentId: string,
  files: Express.Multer.File[],
): Promise<AttachmentRecord[]> {
  if (files.length === 0) return [];
  const dir = path.join(ROOT, bucket, parentId);
  await fs.mkdir(dir, { recursive: true });

  const out: AttachmentRecord[] = [];
  for (const f of files) {
    const stamp = Date.now();
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
    await fs.writeFile(path.join(dir, mainName), main);
    await fs.writeFile(path.join(dir, thumbName), thumb);
    out.push({
      filename: f.originalname,
      url: `/uploads/${bucket}/${parentId}/${mainName}`,
      thumbnailUrl: `/uploads/${bucket}/${parentId}/${thumbName}`,
    });
  }
  return out;
}

/** Best-effort directory cleanup when a parent row is deleted. */
export async function deleteAttachmentDir(
  bucket: AttachmentBucket,
  parentId: string,
): Promise<void> {
  const dir = path.join(ROOT, bucket, parentId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
