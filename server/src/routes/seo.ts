// SEO root-level routes: /sitemap.xml and /robots.txt. Mounted at the
// app root (no /api prefix) because crawlers expect them at the bare
// hostname. The sitemap is generated dynamically so newly-published
// portfolio entries get crawled without a redeploy; robots.txt is
// static text but generated here so it can reference APP_URL.

import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

const STATIC_URLS: Array<{ loc: string; priority: string; changefreq: string }> = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/portfolio', priority: '0.9', changefreq: 'weekly' },
  { loc: '/about', priority: '0.7', changefreq: 'monthly' },
  { loc: '/process', priority: '0.7', changefreq: 'monthly' },
  { loc: '/contact', priority: '0.7', changefreq: 'monthly' },
  { loc: '/start', priority: '0.8', changefreq: 'monthly' },
  { loc: '/services/remodeling', priority: '0.8', changefreq: 'monthly' },
  { loc: '/services/decks', priority: '0.8', changefreq: 'monthly' },
  { loc: '/services/fencing', priority: '0.8', changefreq: 'monthly' },
  { loc: '/services/hardscape', priority: '0.8', changefreq: 'monthly' },
  { loc: '/services/landscape', priority: '0.8', changefreq: 'monthly' },
];

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const base = (process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const projects = await prisma.project.findMany({
      where: { showOnPortfolio: true, portfolioSlug: { not: null } },
      select: { portfolioSlug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    const today = new Date().toISOString().slice(0, 10);
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ];
    for (const u of STATIC_URLS) {
      lines.push(
        `<url><loc>${base}${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
      );
    }
    for (const p of projects) {
      lines.push(
        `<url><loc>${base}/portfolio/${encodeURIComponent(p.portfolioSlug!)}</loc><lastmod>${p.updatedAt.toISOString().slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
      );
    }
    lines.push('</urlset>');

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

router.get('/robots.txt', (req, res) => {
  const base = (process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  // Disallow the portal + API; allow everything else (the marketing site).
  // Sitemap line lets Google discover the dynamic portfolio entries.
  const body = [
    'User-agent: *',
    'Disallow: /portal/',
    'Disallow: /api/',
    'Disallow: /uploads/',
    'Allow: /',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(body);
});

export default router;
