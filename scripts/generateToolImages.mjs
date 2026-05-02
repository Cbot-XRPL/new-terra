// Generate the full set of tool / calculator / estimator hero images
// using OpenAI's gpt-image-1. Reads OPENAI_API_KEY from .env at the
// repo root, writes PNGs to client/public/media/tools/<slug>.png.
//
// Slot list lives in scripts/imagePromptCatalog.mjs so a regen pass
// can target a subset (`node scripts/generateToolImages.mjs slug1 slug2`).

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { CATALOG } from './imagePromptCatalog.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const envPath = path.join(repoRoot, '.env');
const outDir = path.join(repoRoot, 'client', 'public', 'media', 'tools');

async function loadEnv() {
  const txt = await fs.readFile(envPath, 'utf8');
  for (const raw of txt.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

await loadEnv();
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY missing from .env');
await fs.mkdir(outDir, { recursive: true });

// Filter to specific slugs if argv has them — used during regens after
// Claude judges the first batch.
const argSlugs = process.argv.slice(2);
const todo = argSlugs.length > 0
  ? CATALOG.filter((s) => argSlugs.includes(s.slug))
  : CATALOG;

if (todo.length === 0) {
  console.error('No slugs matched. Available:');
  for (const s of CATALOG) console.error(`  - ${s.slug}`);
  process.exit(1);
}

console.log(`[gen] generating ${todo.length} image${todo.length === 1 ? '' : 's'}…`);

async function generateOne(slot) {
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
      prompt: slot.prompt,
      size: slot.size || '1024x1024',
      n: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const payload = await res.json();
  const first = payload?.data?.[0];
  if (!first) throw new Error('no data');
  let buffer;
  if (first.b64_json) {
    buffer = Buffer.from(first.b64_json, 'base64');
  } else if (first.url) {
    const dl = await fetch(first.url);
    buffer = Buffer.from(await dl.arrayBuffer());
  } else {
    throw new Error('response had neither b64_json nor url');
  }
  // Slug like "tools/floor-sketch" → tools/floor-sketch.png. Strip the
  // optional folder prefix from the saved filename so all images live
  // flat under media/tools/.
  const fileName = `${slot.slug.replace(/\//g, '_')}.png`;
  const outPath = path.join(outDir, fileName);
  await fs.writeFile(outPath, buffer);
  return {
    slug: slot.slug,
    path: outPath,
    bytes: buffer.length,
    elapsedMs: Date.now() - t0,
    revisedPrompt: first.revised_prompt ?? null,
  };
}

// Run with a small concurrency cap so we don't get rate-limited or
// blow up the user's quota in one burst.
const concurrency = 3;
const results = [];
const failures = [];

async function worker(queue) {
  while (queue.length > 0) {
    const slot = queue.shift();
    if (!slot) return;
    try {
      const r = await generateOne(slot);
      console.log(
        `[gen] ✓ ${slot.slug} (${(r.bytes / 1024).toFixed(0)} KB, ${r.elapsedMs} ms)`,
      );
      results.push(r);
    } catch (err) {
      console.error(`[gen] ✗ ${slot.slug}: ${err.message}`);
      failures.push({ slug: slot.slug, error: err.message });
    }
  }
}

const q = [...todo];
const workers = Array.from({ length: Math.min(concurrency, q.length) }, () => worker(q));
await Promise.all(workers);

console.log(`\n[gen] done — ${results.length} ok, ${failures.length} failed`);
if (failures.length > 0) {
  console.error('failures:');
  for (const f of failures) console.error(`  - ${f.slug}: ${f.error}`);
  process.exit(1);
}
