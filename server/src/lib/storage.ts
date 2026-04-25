// Pluggable storage backend for project images.
//
// Default: local disk under server/uploads. Swap to S3 by setting
// STORAGE_DRIVER=s3 and filling in the S3_* env vars below — install
// `multer-s3` and `@aws-sdk/client-s3`, then uncomment the s3 branch.

import multer, { type StorageEngine } from 'multer';
import path from 'node:path';
import fs from 'node:fs';

export interface ProjectStorage {
  /** multer storage engine used by the upload route */
  engine: StorageEngine;
  /** Build the public URL stored in the DB row for an uploaded file */
  publicUrl(projectId: string, filename: string): string;
  /** Best-effort delete by the URL we previously generated */
  remove(url: string): Promise<void>;
}

function localStorage(): ProjectStorage {
  const root = path.resolve(process.cwd(), 'uploads', 'projects');
  fs.mkdirSync(root, { recursive: true });

  const engine = multer.diskStorage({
    destination(req, _file, cb) {
      const dir = path.join(root, req.params.id);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename(_req, file, cb) {
      const stamp = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      cb(null, `${stamp}-${safe}`);
    },
  });

  return {
    engine,
    publicUrl(projectId, filename) {
      return `/uploads/projects/${projectId}/${filename}`;
    },
    async remove(url) {
      const filePath = path.join(process.cwd(), url.replace(/^\/+/, ''));
      await fs.promises.unlink(filePath).catch(() => {});
    },
  };
}

// To enable S3:
//   1. npm install @aws-sdk/client-s3 multer-s3
//   2. Set STORAGE_DRIVER=s3 and S3_BUCKET / S3_REGION / S3_PUBLIC_URL.
//   3. Replace localStorage() below with s3Storage() in createStorage().
//
// import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
// import multerS3 from 'multer-s3';
// function s3Storage(): ProjectStorage {
//   const client = new S3Client({ region: process.env.S3_REGION });
//   const Bucket = process.env.S3_BUCKET!;
//   const publicBase = process.env.S3_PUBLIC_URL!; // e.g. https://cdn.example.com
//   const engine = multerS3({
//     s3: client,
//     bucket: Bucket,
//     key: (req, file, cb) => {
//       const stamp = Date.now();
//       const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
//       cb(null, `projects/${req.params.id}/${stamp}-${safe}`);
//     },
//     contentType: multerS3.AUTO_CONTENT_TYPE,
//   });
//   return {
//     engine,
//     publicUrl: (projectId, filename) => `${publicBase}/projects/${projectId}/${filename}`,
//     async remove(url) {
//       const key = url.replace(`${publicBase}/`, '');
//       await client.send(new DeleteObjectCommand({ Bucket, Key: key })).catch(() => {});
//     },
//   };
// }

export function createStorage(): ProjectStorage {
  // const driver = process.env.STORAGE_DRIVER ?? 'local';
  // if (driver === 's3') return s3Storage();
  return localStorage();
}
