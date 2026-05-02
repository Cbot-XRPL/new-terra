// One-off smoke test for the OpenAI image API. Reads OPENAI_API_KEY
// from .env at the repo root, generates a single image, saves it to
// client/public/media/tools/_smoketest.png so we can confirm the
// pipeline works before kicking off the full slot loop.

import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const envPath = path.join(repoRoot, '.env');

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

const prompt = [
  'Isometric editorial illustration of a residential construction site tool icon.',
  'Subject: a wood-handled framing hammer resting on a bundle of 2x4s, a tape measure beside it.',
  'Warm natural wood + matte steel materials, soft directional studio lighting from upper left.',
  'Deep navy background. No text, no logos, no people. Tight composition, clean negative space.',
  'Style: digital editorial, slightly stylized, photoreal materials.',
].join(' ');

console.log('[smoketest] requesting image...');
const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    prompt,
    size: '1024x1024',
    n: 1,
  }),
});

if (!res.ok) {
  const text = await res.text();
  console.error('[smoketest] HTTP', res.status, text.slice(0, 600));
  process.exit(1);
}

const payload = await res.json();
const first = payload?.data?.[0];
if (!first) {
  console.error('[smoketest] no data in response', JSON.stringify(payload).slice(0, 400));
  process.exit(1);
}

let buffer;
if (first.b64_json) {
  buffer = Buffer.from(first.b64_json, 'base64');
} else if (first.url) {
  const dl = await fetch(first.url);
  buffer = Buffer.from(await dl.arrayBuffer());
} else {
  console.error('[smoketest] response had neither b64_json nor url');
  process.exit(1);
}

const outPath = path.join(repoRoot, 'client', 'public', 'media', 'tools', '_smoketest.png');
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, buffer);
console.log(`[smoketest] saved ${outPath} (${buffer.length} bytes)`);
if (first.revised_prompt) {
  console.log(`[smoketest] revised_prompt: ${first.revised_prompt.slice(0, 200)}`);
}
