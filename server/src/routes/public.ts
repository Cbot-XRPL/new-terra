import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendInquiryEmail } from '../lib/mailer.js';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

async function verifyTurnstile(token: string | undefined, ip?: string): Promise<boolean> {
  // No secret configured means Turnstile is off — always pass.
  if (!TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch (err) {
    console.warn('[turnstile] verification request failed', err);
    return false;
  }
}

const router = Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 submissions per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const contactSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional().nullable(),
  message: z.string().min(1).max(5000),
  // Honeypot — real users won't fill this; bots usually do. Validated leniently
  // so a filled value still parses; we silently succeed below.
  website: z.string().max(500).optional(),
  // Cloudflare Turnstile token — only required when TURNSTILE_SECRET_KEY is set.
  turnstileToken: z.string().optional(),
});

router.post('/contact', contactLimiter, async (req, res, next) => {
  try {
    // Honeypot pre-check — done before parsing so a bot's payload that looks
    // otherwise valid still gets a 200 with no email sent.
    if (typeof req.body?.website === 'string' && req.body.website.length > 0) {
      return res.json({ ok: true });
    }
    const data = contactSchema.parse(req.body);

    const turnstileOk = await verifyTurnstile(data.turnstileToken, req.ip);
    if (!turnstileOk) {
      return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    }

    await sendInquiryEmail({
      name: data.name,
      email: data.email,
      phone: data.phone ?? undefined,
      message: data.message,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
