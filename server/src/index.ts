import express from 'express';
import cors from 'cors';
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

const app = express();

app.use(cors({ origin: env.appUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Static file serving for uploaded images. In production this should be S3 or
// similar; this works fine for a single-host install.
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/portal', portalRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', projectImagesRouter);
app.use('/api/schedules', schedulesRouter);

app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`[server] http://localhost:${env.port}`);
});
