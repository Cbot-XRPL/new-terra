import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hashToken, runSatisfactionSurveys } from '../lib/satisfactionSurveys.js';
import { hasAccountingAccess } from '../lib/permissions.js';

const router = Router();

// ---------- Public token-based read + submit ----------

router.get('/public/survey/:token', async (req, res, next) => {
  try {
    const survey = await prisma.satisfactionSurvey.findUnique({
      where: { tokenHash: hashToken(req.params.token) },
      include: {
        project: { select: { name: true } },
        customer: { select: { name: true } },
      },
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    res.json({
      project: survey.project.name,
      customerFirstName: survey.customer.name.split(/\s+/)[0],
      submitted: survey.submittedAt !== null,
      score: survey.score,
      comments: survey.comments,
      improvements: survey.improvements,
    });
  } catch (err) { next(err); }
});

const submitSchema = z.object({
  score: z.number().int().min(0).max(10),
  comments: z.string().max(2000).nullable().optional(),
  improvements: z.string().max(2000).nullable().optional(),
});

router.post('/public/survey/:token', async (req, res, next) => {
  try {
    const survey = await prisma.satisfactionSurvey.findUnique({
      where: { tokenHash: hashToken(req.params.token) },
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (survey.submittedAt) return res.status(409).json({ error: 'Already submitted' });
    const data = submitSchema.parse(req.body);
    const updated = await prisma.satisfactionSurvey.update({
      where: { id: survey.id },
      data: {
        score: data.score,
        comments: data.comments ?? null,
        improvements: data.improvements ?? null,
        submittedAt: new Date(),
      },
    });
    res.json({ ok: true, submittedAt: updated.submittedAt });
  } catch (err) { next(err); }
});

// ---------- Authed admin/accounting dashboard ----------

router.use(requireAuth);

router.get('/admin/satisfaction-surveys', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || !hasAccountingAccess(me)) return res.status(403).json({ error: 'Forbidden' });

    const surveys = await prisma.satisfactionSurvey.findMany({
      orderBy: [{ submittedAt: 'desc' }, { sentAt: 'desc' }],
      include: {
        project: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, email: true } },
      },
    });
    // Roll up NPS — promoters (9–10) − detractors (0–6) over total scored.
    const scored = surveys.filter((s) => typeof s.score === 'number');
    const promoters = scored.filter((s) => (s.score ?? 0) >= 9).length;
    const detractors = scored.filter((s) => (s.score ?? 0) <= 6).length;
    const passives = scored.length - promoters - detractors;
    const nps = scored.length > 0
      ? Math.round(((promoters - detractors) / scored.length) * 1000) / 10
      : null;
    res.json({
      surveys,
      summary: {
        total: surveys.length,
        sent: surveys.filter((s) => s.sentAt).length,
        submitted: scored.length,
        avgScore: scored.length > 0
          ? Math.round((scored.reduce((s, x) => s + (x.score ?? 0), 0) / scored.length) * 10) / 10
          : null,
        promoters,
        passives,
        detractors,
        nps,
      },
    });
  } catch (err) { next(err); }
});

// Admin manual run of the cron (e.g. from the dashboard) without waiting
// for the scheduled fire. Same shape as the other manual triggers.
router.post('/admin/satisfaction-surveys/_run', async (req, res, next) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!me || me.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
    const result = await runSatisfactionSurveys();
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
