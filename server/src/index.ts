import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import cron from 'node-cron';
import { env } from './env.js';
import { remindStaleContracts } from './lib/reminders.js';
import { errorHandler } from './middleware/error.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import portalRouter from './routes/portal.js';
import projectsRouter from './routes/projects.js';
import schedulesRouter from './routes/schedules.js';
import projectImagesRouter from './routes/projectImages.js';
import invoicesRouter from './routes/invoices.js';
import messagesRouter from './routes/messages.js';
import selectionsRouter from './routes/selections.js';
import membershipsRouter from './routes/memberships.js';
import logEntriesRouter from './routes/logEntries.js';
import boardRouter from './routes/board.js';
import publicRouter from './routes/public.js';
import contractTemplatesRouter from './routes/contractTemplates.js';
import contractsRouter from './routes/contracts.js';

const app = express();

// Trust the first hop (reverse proxy / load balancer) in production so the
// rate limiter and any future logging see the real client IP rather than the
// proxy's. Local dev runs without a proxy so trust stays off.
if (env.nodeEnv === 'production') app.set('trust proxy', 1);

app.use(cors({ origin: env.appUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Static file serving for uploaded images. In production this should be S3 or
// similar; this works fine for a single-host install.
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.use('/api/public', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/portal', portalRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', projectImagesRouter);
app.use('/api/projects', selectionsRouter);
app.use('/api/projects', logEntriesRouter);
app.use('/api/memberships', membershipsRouter);
app.use('/api/board', boardRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/contract-templates', contractTemplatesRouter);
app.use('/api/contracts', contractsRouter);

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

app.listen(env.port, () => {
  console.log(`[server] http://localhost:${env.port}`);
});

// Daily stale-contract reminder. Off by default in development so working on
// the API doesn't accidentally send emails; flip CONTRACT_REMINDER_CRON to a
// valid cron expression (e.g. "0 9 * * *" for 9:00am every day) in prod.
const reminderSchedule = process.env.CONTRACT_REMINDER_CRON;
if (reminderSchedule) {
  if (cron.validate(reminderSchedule)) {
    cron.schedule(reminderSchedule, () => {
      remindStaleContracts()
        .then((r) => console.log('[cron:contract-reminders]', r))
        .catch((err) => console.warn('[cron:contract-reminders] failed', err));
    });
    console.log(`[cron] contract reminders scheduled "${reminderSchedule}"`);
  } else {
    console.warn(`[cron] CONTRACT_REMINDER_CRON="${reminderSchedule}" is not a valid expression; skipping`);
  }
}
