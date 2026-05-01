import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { env } from './env.js';
import { errorHandler } from './middleware/error.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import portalRouter from './routes/portal.js';
import projectsRouter from './routes/projects.js';
import schedulesRouter from './routes/schedules.js';
import projectImagesRouter from './routes/projectImages.js';
import projectDocumentsRouter from './routes/projectDocuments.js';
import invoicesRouter from './routes/invoices.js';
import messagesRouter from './routes/messages.js';
import selectionsRouter from './routes/selections.js';
import membershipsRouter from './routes/memberships.js';
import logEntriesRouter from './routes/logEntries.js';
import boardRouter from './routes/board.js';
import publicRouter from './routes/public.js';
import publicPortfolioRouter from './routes/publicPortfolio.js';
import contractTemplatesRouter from './routes/contractTemplates.js';
import contractsRouter from './routes/contracts.js';
import bulkImportRouter from './routes/bulkImport.js';
import webhooksRouter from './routes/webhooks.js';
import leadsRouter from './routes/leads.js';
import projectCommentsRouter from './routes/projectComments.js';
import meRouter from './routes/me.js';
import financeRouter from './routes/finance.js';
import quickbooksRouter from './routes/quickbooks.js';
import estimateTemplatesRouter from './routes/estimateTemplates.js';
import estimatesRouter from './routes/estimates.js';
import catalogRouter from './routes/catalog.js';
import timeRouter from './routes/time.js';
import settingsRouter from './routes/settings.js';
import changeOrdersRouter from './routes/changeOrders.js';
import recurringInvoicesRouter from './routes/recurringInvoices.js';
import subcontractorBillsRouter from './routes/subcontractorBills.js';
import bankingRouter from './routes/banking.js';
import mileageRouter from './routes/mileage.js';
import punchListRouter from './routes/punchList.js';
import galleryShareRouter from './routes/galleryShares.js';
import satisfactionSurveyRouter from './routes/satisfactionSurveys.js';
import inventoryRouter from './routes/inventory.js';
import searchRouter from './routes/search.js';
import seoRouter from './routes/seo.js';
import drawsRouter from './routes/draws.js';
import channelsRouter from './routes/channels.js';
import plaidRouter from './routes/plaid.js';
import attachmentsRouter from './routes/attachments.js';
import aiRouter from './routes/ai.js';

// Builds an express app without binding to a port. The listen() call lives
// in index.ts so the test suite can import this factory and hand the app to
// supertest without competing for ports.
export function createApp(): Express {
  const app = express();

  // Trust the first hop (reverse proxy / load balancer) in production so the
  // rate limiter and any future logging see the real client IP rather than the
  // proxy's. Local dev runs without a proxy so trust stays off.
  if (env.nodeEnv === 'production') app.set('trust proxy', 1);

  // Security headers. The default helmet config gives HSTS, X-Frame-Options,
  // X-Content-Type-Options, Referrer-Policy, and a sensible Permissions-Policy.
  // We disable CSP because we serve cross-origin images (DocuSign tabs) and
  // inline styles inside the SPA; tighten this once the asset story is locked.
  // crossOriginResourcePolicy is set to cross-origin so the SPA on a separate
  // origin (Vite dev) can pull /uploads/... images.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cors({ origin: env.appUrl, credentials: true }));

  // Webhook endpoints need the raw request body so they can verify signatures
  // against the exact bytes the sender signed. Mount them BEFORE express.json
  // so the JSON parser doesn't consume the stream first.
  app.use('/api/webhooks', webhooksRouter);

  app.use(express.json({ limit: '2mb' }));
  // Skip request logging during tests — vitest output stays readable.
  if (env.nodeEnv !== 'test') {
    app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Static file serving for uploaded images. In production this should be S3
  // or similar; this works fine for a single-host install.
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  app.use('/api/public', publicRouter);
  app.use('/api/public', publicPortfolioRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/portal', portalRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects', projectImagesRouter);
  app.use('/api/projects', projectDocumentsRouter);
  app.use('/api/projects', selectionsRouter);
  app.use('/api/projects', logEntriesRouter);
  app.use('/api/memberships', membershipsRouter);
  app.use('/api/board', boardRouter);
  app.use('/api/channels', channelsRouter);
  app.use('/api/schedules', schedulesRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/messages', messagesRouter);
  app.use('/api/contract-templates', contractTemplatesRouter);
  app.use('/api/contracts', contractsRouter);
  app.use('/api/admin/bulk', bulkImportRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/projects', projectCommentsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/integrations/quickbooks', quickbooksRouter);
  app.use('/api/estimate-templates', estimateTemplatesRouter);
  app.use('/api/estimates', estimatesRouter);
  // Lead + estimate attachment endpoints — mounted at /api so the
  // routes use /api/leads/:id/attachments + /api/estimates/:id/attachments.
  app.use('/api', attachmentsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/time', timeRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/change-orders', changeOrdersRouter);
  app.use('/api/recurring-invoices', recurringInvoicesRouter);
  app.use('/api/subcontractor-bills', subcontractorBillsRouter);
  app.use('/api/banking', bankingRouter);
  app.use('/api/mileage', mileageRouter);
  app.use('/api/projects', punchListRouter);
  // Mounted at /api so the public route lives at /api/public/gallery/:token
  // and the authed routes live at /api/projects/:projectId/shares.
  app.use('/api', galleryShareRouter);
  app.use('/api', satisfactionSurveyRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/draws', drawsRouter);
  app.use('/api/integrations/plaid', plaidRouter);
  // SEO root paths — /sitemap.xml and /robots.txt. Mounted at root (not
  // under /api) so crawlers hit the canonical URLs.
  app.use('/', seoRouter);

  // In production, serve the built React client from this same process. The
  // SPA fallback comes after every /api route is registered so client routes
  // never shadow the API.
  if (env.nodeEnv === 'production') {
    const clientDist = path.resolve(process.cwd(), '..', 'client', 'dist');
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
