// Convert every PNG under client/public/media/tools/ to WebP at 1280px
// max width, 82% quality. PNGs are 1.5–2.3 MB each from gpt-image-1;
// WebP at this setting lands ~80–150 KB with no perceivable quality
// loss on the tool-card aspect ratios we render at. After running this,
// the originals are deleted so we don't ship both.
//
// Run with: node scripts/compressToolImages.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import sharp from 'sharp';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const dir = path.join(repoRoot, 'client', 'public', 'media', 'tools');

const entries = await fs.readdir(dir);
const pngs = entries.filter((e) => e.endsWith('.png'));
console.log(`[compress] ${pngs.length} PNG(s) → WebP`);

let savedBytes = 0;
for (const name of pngs) {
  const pngPath = path.join(dir, name);
  const webpPath = path.join(dir, name.replace(/\.png$/, '.webp'));
  const before = (await fs.stat(pngPath)).size;
  await sharp(pngPath)
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(webpPath);
  const after = (await fs.stat(webpPath)).size;
  await fs.unlink(pngPath);
  const ratio = (1 - after / before) * 100;
  console.log(
    `  ${name.replace(/\.png$/, '')}  ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB  (-${ratio.toFixed(0)}%)`,
  );
  savedBytes += before - after;
}
console.log(`[compress] saved ${(savedBytes / 1024 / 1024).toFixed(1)} MB`);
