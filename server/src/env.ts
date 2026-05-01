import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

// Monorepo: .env lives at the repo root, not server/. Walk up from cwd
// looking for it so the same code works whether we're invoked from the
// repo root (npm run dev) or from server/ (npm --workspace server run …).
function findEnvFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envFile = findEnvFile();
// `override: true` so the .env file is the source of truth — without it,
// any stale value already in process.env (e.g. captured by PM2 at first
// launch before .env was filled in) silently wins and dotenv is a no-op.
if (envFile) dotenv.config({ path: envFile, override: true });
else dotenv.config({ override: true });

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
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    // Resend requires either a verified sending domain OR the test address
    // `onboarding@resend.dev` (which only delivers to the email you signed
    // up with). Override RESEND_FROM in the prod .env once a domain is
    // verified at https://resend.com/domains.
    from: process.env.RESEND_FROM ?? 'New Terra Construction <onboarding@resend.dev>',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'no-reply@newterraconstruction.com',
  },
  plaid: {
    // dashboard.plaid.com → Team Settings → Keys. PLAID_ENV is one of
    // 'sandbox' (free dev), 'development' (limited live), or 'production'.
    clientId: process.env.PLAID_CLIENT_ID ?? '',
    secret: process.env.PLAID_SECRET ?? '',
    env: (process.env.PLAID_ENV ?? 'sandbox') as 'sandbox' | 'development' | 'production',
    // Optional verification key for webhook signature checking. Without
    // it the webhook still works but signatures aren't verified — fine
    // for dev / sandbox.
    webhookSecret: process.env.PLAID_WEBHOOK_SECRET ?? '',
  },
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@newterraconstruction.com',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'changeMe!2026',
    name: process.env.SEED_ADMIN_NAME ?? 'Site Admin',
  },
  openai: {
    // platform.openai.com → API Keys → create. Used for the image-gen
    // pipeline (gpt-image-1) that draws calculator skins, sketch icons,
    // and other UI assets the GC asks Claude to coordinate. NEVER paste
    // a key into chat or commit messages — store only here.
    apiKey: process.env.OPENAI_API_KEY ?? '',
    imageModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
  },
  google: {
    // console.cloud.google.com → APIs & Services → Credentials → OAuth
    // 2.0 Client IDs (Web application). Authorized redirect URIs must
    // include both /api/auth/google/callback and /api/integrations/
    // google-drive/callback under your APP_URL.
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
  anthropic: {
    // console.anthropic.com → API Keys → create. Set a monthly budget
    // cap on the key so a runaway loop can't blow the bill up.
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    // Default to Haiku 4.5 — cheap + fast for chat. Override to
    // claude-sonnet-4-6 or claude-opus-4-7 if you want more horsepower
    // on specific routes.
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
  },
};
