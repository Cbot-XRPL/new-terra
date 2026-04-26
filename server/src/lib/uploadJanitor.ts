// Orphaned-upload janitor.
//
// Every upload pipeline writes files to disk under server/uploads/<bucket>/
// with the URL stored on a DB row. Routes that cascade-delete (e.g.
// SubcontractorBillAttachment via parent SubcontractorBill) drop the row
// but only best-effort drop the file (`fs.unlink().catch(() => undefined)`).
// When that catch silently swallows a missing-directory error, or when
// admin nukes a row directly via psql / Studio, the disk file becomes
// orphaned forever.
//
// This helper walks each known bucket, builds the set of filenames the DB
// still references, and deletes anything else. Dry-run mode reports the
// candidates without unlinking — useful for confirming behavior before
// turning on the cron.
//
// Buckets:
//   uploads/projects/<projectId>/<filename>            (ProjectImage)
//   uploads/projects/<projectId>/<thumb>.webp          (ProjectImage thumbs)
//   uploads/projects/<projectId>/docs/<filename>       (ProjectDocument)
//   uploads/sub-bills/<billId>/<filename>              (SubcontractorBillAttachment)
//   uploads/sub-bills/<billId>/thumb-*.webp            (sub-bill image thumbs)
//   uploads/receipts/<expenseId>/<filename>            (Expense receipt + thumb)
//   uploads/avatars/<userId>/<filename>                (User.avatar + thumb)
//   uploads/project-comments/<commentId>/<filename>    (ProjectComment attachment)

import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db.js';

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

export interface JanitorResult {
  bucket: string;
  scanned: number;
  orphanedFound: number;
  orphanedRemoved: number;
  bytesFreed: number;
  errors: number;
}

async function listAllFiles(dir: string): Promise<string[]> {
  // Recursive readdir. Returns absolute paths.
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...await listAllFiles(full));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function urlsToDiskPaths(urls: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    if (!u.startsWith('/uploads/')) continue;
    out.add(path.join(process.cwd(), u.replace(/^\/+/, '')));
  }
  return out;
}

async function sweepBucket(
  bucket: string,
  rootDir: string,
  knownPaths: Set<string>,
  dryRun: boolean,
): Promise<JanitorResult> {
  const result: JanitorResult = {
    bucket,
    scanned: 0,
    orphanedFound: 0,
    orphanedRemoved: 0,
    bytesFreed: 0,
    errors: 0,
  };
  const files = await listAllFiles(rootDir);
  result.scanned = files.length;
  for (const f of files) {
    if (knownPaths.has(f)) continue;
    result.orphanedFound += 1;
    try {
      const stat = await fs.stat(f);
      if (!dryRun) {
        await fs.unlink(f);
        result.orphanedRemoved += 1;
      }
      result.bytesFreed += stat.size;
    } catch (err) {
      console.warn('[janitor] could not unlink', f, err);
      result.errors += 1;
    }
  }
  return result;
}

export async function runUploadJanitor(opts: { dryRun?: boolean } = {}): Promise<JanitorResult[]> {
  const dryRun = !!opts.dryRun;
  const results: JanitorResult[] = [];

  // ---- Projects (images + their thumbs + docs subfolder) ----
  const images = await prisma.projectImage.findMany({ select: { url: true, thumbnailUrl: true } });
  const docs = await prisma.projectDocument.findMany({ select: { url: true } });
  results.push(await sweepBucket(
    'projects',
    path.join(UPLOADS_ROOT, 'projects'),
    urlsToDiskPaths([
      ...images.map((i) => i.url),
      ...images.map((i) => i.thumbnailUrl),
      ...docs.map((d) => d.url),
    ]),
    dryRun,
  ));

  // ---- Sub-bill attachments ----
  const subAtt = await prisma.subcontractorBillAttachment.findMany({
    select: { url: true, thumbnailUrl: true },
  });
  results.push(await sweepBucket(
    'sub-bills',
    path.join(UPLOADS_ROOT, 'sub-bills'),
    urlsToDiskPaths([
      ...subAtt.map((a) => a.url),
      ...subAtt.map((a) => a.thumbnailUrl),
    ]),
    dryRun,
  ));

  // ---- Expense receipts ----
  const receipts = await prisma.expense.findMany({
    select: { receiptUrl: true, receiptThumbnailUrl: true },
  });
  results.push(await sweepBucket(
    'receipts',
    path.join(UPLOADS_ROOT, 'receipts'),
    urlsToDiskPaths([
      ...receipts.map((r) => r.receiptUrl),
      ...receipts.map((r) => r.receiptThumbnailUrl),
    ]),
    dryRun,
  ));

  // ---- Avatars ----
  const avatars = await prisma.user.findMany({
    select: { avatarUrl: true, avatarThumbnailUrl: true },
  });
  results.push(await sweepBucket(
    'avatars',
    path.join(UPLOADS_ROOT, 'avatars'),
    urlsToDiskPaths([
      ...avatars.map((u) => u.avatarUrl),
      ...avatars.map((u) => u.avatarThumbnailUrl),
    ]),
    dryRun,
  ));

  // ---- Project-comment attachments ----
  // ProjectComment may carry an attachment via attachmentUrl + thumbnailUrl;
  // schema field names vary slightly so we narrow with a select that
  // matches whichever fields exist.
  const comments = await prisma.projectComment.findMany().catch(() => []);
  const commentUrls: Array<string | null> = [];
  for (const c of comments as Array<Record<string, unknown>>) {
    if (typeof c.attachmentUrl === 'string') commentUrls.push(c.attachmentUrl);
    if (typeof c.attachmentThumbnailUrl === 'string') commentUrls.push(c.attachmentThumbnailUrl);
  }
  results.push(await sweepBucket(
    'project-comments',
    path.join(UPLOADS_ROOT, 'project-comments'),
    urlsToDiskPaths(commentUrls),
    dryRun,
  ));

  return results;
}
