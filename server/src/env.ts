import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'no-reply@newterraconstruction.com',
  },
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@newterraconstruction.com',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'changeMe!2026',
    name: process.env.SEED_ADMIN_NAME ?? 'Site Admin',
  },
};
