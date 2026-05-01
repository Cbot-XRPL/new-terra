// OpenAI image generation. Admin-only endpoint that proxies through
// gpt-image-1 (or whatever OPENAI_IMAGE_MODEL is set to) and saves the
// generated PNG to disk under uploads/generated/. Designed to be
// driven from a Claude Code session: Claude calls this with a prompt,
// reads the resulting file from disk, judges fit, and re-runs with an
// adjusted prompt if the output isn't right.
//
// We never accept the API key from the request — it lives in env only.
// Returning the saved file URL means the caller can pull the image,
// not that we expose any credential.

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth, requireRole(Role.ADMIN));

const GENERATED_ROOT = path.resolve(process.cwd(), 'uploads', 'generated');
fsSync.mkdirSync(GENERATED_ROOT, { recursive: true });

const generateSchema = z.object({
  prompt: z.string().min(4).max(4000),
  // Square / portrait / landscape — gpt-image-1 supports 1024x1024,
  // 1024x1536, 1536x1024. Defaults to square.
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional(),
  // Optional folder under uploads/generated/ so calculator skins, icons,
  // marketing visuals, etc. don't all pile in one bucket.
  folder: z
    .string()
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'folder must be lowercase letters, digits, dashes')
    .optional(),
  // Tag string saved alongside the image — useful when this is part of
  // a Claude judge-and-regen loop and we want to keep iteration history.
  tag: z.string().max(120).optional(),
});

router.post('/generate', async (req, res, next) => {
  try {
    if (!env.openai.apiKey) {
      return res.status(503).json({
        error: 'OpenAI is not configured. Set OPENAI_API_KEY in .env and restart.',
      });
    }
    const { prompt, size, folder, tag } = generateSchema.parse(req.body);

    const apiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: env.openai.imageModel,
        prompt,
        size: size ?? '1024x1024',
        n: 1,
      }),
    });
    if (!apiRes.ok) {
      const text = await apiRes.text();
      return res.status(apiRes.status).json({
        error: `OpenAI rejected the request: ${text.slice(0, 500)}`,
      });
    }
    const payload = (await apiRes.json()) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const first = payload.data?.[0];
    if (!first?.b64_json && !first?.url) {
      return res.status(502).json({ error: 'OpenAI response had no image data' });
    }

    let buffer: Buffer;
    if (first.b64_json) {
      buffer = Buffer.from(first.b64_json, 'base64');
    } else {
      // Some models return a URL instead. Fetch + cache locally so the
      // file lifecycle is ours, not OpenAI's CDN.
      const dl = await fetch(first.url!);
      if (!dl.ok) {
        return res.status(502).json({ error: 'Could not download image from OpenAI URL' });
      }
      buffer = Buffer.from(await dl.arrayBuffer());
    }

    const subdir = folder ?? 'misc';
    const dir = path.join(GENERATED_ROOT, subdir);
    await fs.mkdir(dir, { recursive: true });
    const stamp = Date.now();
    const slug = (tag ?? 'image').replace(/[^a-z0-9-]+/gi, '-').slice(0, 32) || 'image';
    const filename = `${stamp}-${slug}.png`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, buffer);
    const url = `/uploads/generated/${subdir}/${filename}`;

    await audit(req, {
      action: 'imagegen.generate',
      meta: {
        size: size ?? '1024x1024',
        folder: subdir,
        prompt: prompt.slice(0, 200),
        revisedPrompt: first.revised_prompt?.slice(0, 200) ?? null,
      },
    });

    res.json({
      url,
      revisedPrompt: first.revised_prompt ?? null,
      size: size ?? '1024x1024',
    });
  } catch (err) {
    next(err);
  }
});

export default router;
