// Public marketing endpoints for the portfolio + testimonials +
// auto-computed trust stats. Mounted at /api/public/* — no auth.
//
// Strict redaction: customer name/email/address never leaves these
// endpoints. We include the project's name + address city/state only
// when the project is opted in via showOnPortfolio. Internal fields
// (budget, customer relations, contracts, payments) are not surfaced.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();

interface PortfolioCard {
  slug: string;
  title: string;
  serviceCategory: string | null;
  publicSummary: string | null;
  city: string | null;
  state: string | null;
  completedAt: string | null;
  heroImageUrl: string | null;
  heroThumbnailUrl: string | null;
  photoCount: number;
}

// Strip a full address into city + state for display ("Anytown, NY") —
// hides the customer's exact street.
function publicLocation(address: string | null): { city: string | null; state: string | null } {
  if (!address) return { city: null, state: null };
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { city: null, state: null };
  // Last two segments are typically state/zip and city. We take the last
  // segment as state (strip trailing zip) and second-to-last as city.
  const last = parts[parts.length - 1];
  const stateMatch = last.match(/([A-Z]{2})/);
  const state = stateMatch ? stateMatch[1] : null;
  const city = parts[parts.length - 2] ?? null;
  return { city, state };
}

router.get('/portfolio', async (req, res, next) => {
  try {
    const q = z.object({
      category: z.string().max(60).optional(),
    }).parse(req.query);

    const where: Record<string, unknown> = {
      showOnPortfolio: true,
      portfolioSlug: { not: null },
    };
    if (q.category) where.serviceCategory = q.category;

    const projects = await prisma.project.findMany({
      where,
      orderBy: [{ endDate: 'desc' }, { updatedAt: 'desc' }],
      include: {
        images: {
          orderBy: [
            // Hero first (matched by id below), then 'after' phase, then
            // most recent. We re-sort in JS so we can promote the hero.
            { takenAt: 'desc' },
            { createdAt: 'desc' },
          ],
          select: {
            id: true, url: true, thumbnailUrl: true, mediumUrl: true, phase: true,
          },
        },
      },
    });

    const cards: PortfolioCard[] = projects.map((p) => {
      // Hero choice priority:
      //  1. The image whose id is project.heroImageId (if admin set it)
      //  2. First photo whose phase contains 'after'
      //  3. First photo overall (newest, by takenAt desc)
      let hero = p.images.find((i) => i.id === p.heroImageId)
        ?? p.images.find((i) => (i.phase ?? '').toLowerCase().includes('after'))
        ?? p.images[0]
        ?? null;
      const loc = publicLocation(p.address);
      return {
        slug: p.portfolioSlug!,
        title: p.name,
        serviceCategory: p.serviceCategory,
        publicSummary: p.publicSummary,
        city: loc.city,
        state: loc.state,
        completedAt: p.endDate ? p.endDate.toISOString() : null,
        heroImageUrl: hero?.mediumUrl ?? hero?.url ?? null,
        heroThumbnailUrl: hero?.thumbnailUrl ?? hero?.url ?? null,
        photoCount: p.images.length,
      };
    });

    // Build the unique category list so the front-end can render filter
    // chips without a second round-trip.
    const categories = Array.from(
      new Set(projects.map((p) => p.serviceCategory).filter((c): c is string => !!c)),
    ).sort();

    res.json({ projects: cards, categories });
  } catch (err) { next(err); }
});

router.get('/portfolio/:slug', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { portfolioSlug: req.params.slug },
      include: {
        images: {
          orderBy: [{ takenAt: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true, url: true, thumbnailUrl: true, mediumUrl: true, caption: true,
            phase: true, takenAt: true, createdAt: true,
          },
        },
        // Pull the customer's approved survey (if any) for the testimonial
        // block. Survey.publicApprovedAt nullable filter ensures we never
        // leak unapproved feedback.
        satisfactionSurvey: {
          select: {
            score: true, publicQuote: true, publicAttribution: true, publicApprovedAt: true,
          },
        },
      },
    });
    if (!project || !project.showOnPortfolio || !project.portfolioSlug) {
      return res.status(404).json({ error: 'Not found' });
    }
    const loc = publicLocation(project.address);
    const survey = project.satisfactionSurvey?.publicApprovedAt && project.satisfactionSurvey.publicQuote
      ? {
          score: project.satisfactionSurvey.score,
          quote: project.satisfactionSurvey.publicQuote,
          attribution: project.satisfactionSurvey.publicAttribution,
        }
      : null;
    res.json({
      slug: project.portfolioSlug,
      title: project.name,
      serviceCategory: project.serviceCategory,
      publicSummary: project.publicSummary,
      city: loc.city,
      state: loc.state,
      startedAt: project.startDate ? project.startDate.toISOString() : null,
      completedAt: project.endDate ? project.endDate.toISOString() : null,
      photos: project.images.map((i) => ({
        id: i.id,
        url: i.url,
        thumbnailUrl: i.thumbnailUrl,
        mediumUrl: i.mediumUrl,
        caption: i.caption,
        phase: i.phase,
        // Resolved at — same fallback used in portal timeline.
        at: (i.takenAt ?? i.createdAt).toISOString(),
      })),
      heroImageId: project.heroImageId,
      testimonial: survey,
    });
  } catch (err) { next(err); }
});

// Approved testimonials for the home page rotation. Returns the most
// recent N approvals; defaults to 6 (carousel sweet spot).
router.get('/testimonials', async (req, res, next) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 6)));
    const surveys = await prisma.satisfactionSurvey.findMany({
      where: { publicApprovedAt: { not: null }, publicQuote: { not: null } },
      orderBy: { publicApprovedAt: 'desc' },
      take: limit,
      include: { project: { select: { name: true, portfolioSlug: true, showOnPortfolio: true } } },
    });
    res.json({
      testimonials: surveys.map((s) => ({
        score: s.score,
        quote: s.publicQuote,
        attribution: s.publicAttribution,
        projectName: s.project.name,
        // Link to the portfolio entry only when the project is also opted
        // in (otherwise the testimonial leads to a 404).
        portfolioSlug: s.project.showOnPortfolio ? s.project.portfolioSlug : null,
      })),
    });
  } catch (err) { next(err); }
});

// Auto-computed trust signals for the home page hero. All counts are
// scoped to non-archived projects so old test data doesn't inflate them.
router.get('/stats', async (_req, res, next) => {
  try {
    const [completedCount, customerCount, surveyAgg, oldestProject] = await Promise.all([
      prisma.project.count({
        where: { archivedAt: null, status: 'COMPLETE' },
      }),
      prisma.user.count({ where: { role: 'CUSTOMER', isActive: true } }),
      prisma.satisfactionSurvey.aggregate({
        where: { score: { not: null } },
        _avg: { score: true },
        _count: { _all: true },
      }),
      // Loose "years in business" from the earliest project's createdAt.
      // It's a reasonable proxy until admin asks for a real foundedYear
      // setting. Returns null on a fresh install with no projects.
      prisma.project.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    res.json({
      completedProjects: completedCount,
      activeCustomers: customerCount,
      averageScore: surveyAgg._avg.score != null
        ? Math.round(surveyAgg._avg.score * 10) / 10
        : null,
      surveyResponses: surveyAgg._count._all,
      yearsInBusiness: oldestProject
        ? Math.max(1, new Date().getFullYear() - oldestProject.createdAt.getFullYear())
        : null,
    });
  } catch (err) { next(err); }
});

export default router;
