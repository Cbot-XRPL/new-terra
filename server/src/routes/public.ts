import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { sendInquiryEmail } from '../lib/mailer.js';

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
  // Honeypot — real users won't fill this; bots usually do.
  website: z.string().max(0).optional(),
});

router.post('/contact', contactLimiter, async (req, res, next) => {
  try {
    const data = contactSchema.parse(req.body);

    // Silent success when honeypot is filled — don't tell the bot it was caught.
    if (data.website && data.website.length > 0) {
      return res.json({ ok: true });
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
