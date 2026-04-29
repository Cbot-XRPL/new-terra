// Wipe the embedded Postgres data dir + repo-root .env so the next
// `npm run db:setup` re-initialises the cluster from scratch. Used when
// the cluster's encoding is wrong (Windows default WIN1252 vs UTF-8) or
// when you just want a clean slate during development.
//
// Custom-set env vars (RESEND_API_KEY, etc.) are preserved across the
// reset so you don't lose hand-pasted secrets.
//
// Run: npm --workspace server run db:reset

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const serverDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(serverDir, '.pgdata');
const rootEnv = path.join(repoRoot, '.env');

// Env vars that db:setup re-generates from scratch. Anything else in the
// existing .env (Resend, SMTP creds, Stripe, DocuSign, custom crons…)
// gets preserved across the reset.
const REGENERATED_KEYS = new Set([
  'DATABASE_URL',
  'JWT_SECRET',
]);

function readEnv(file: string): Map<string, string> {
  if (!fs.existsSync(file)) return new Map();
  const out = new Map<string, string>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
}

function appendPreservedEnv(file: string, preserved: Map<string, string>) {
  if (preserved.size === 0) return;
  const current = readEnv(file);
  let added = '';
  for (const [k, v] of preserved) {
    if (!current.has(k)) added += `${k}=${v}\n`;
  }
  if (added) {
    fs.appendFileSync(file, `\n# --- Preserved by db:reset ---\n${added}`);
    console.log(`[reset] re-applied ${added.split('\n').filter(Boolean).length} custom env var(s)`);
  }
}

function wipe(p: string) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`[reset] removed ${path.relative(repoRoot, p)}`);
  }
}

function main() {
  console.log('[reset] wiping local DB + env to start fresh…');

  // Capture custom env vars before wiping the file so we can re-apply
  // them after db:setup writes a fresh one.
  const existing = readEnv(rootEnv);
  const preserved = new Map<string, string>();
  for (const [k, v] of existing) {
    if (!REGENERATED_KEYS.has(k) && !v.includes('newterraconstruction.com')) {
      // Skip the seeded SEED_ADMIN_* defaults too — db:setup re-writes
      // those from .env.example-style values.
      preserved.set(k, v);
    }
  }

  wipe(dataDir);
  wipe(rootEnv);

  console.log('[reset] running db:setup to rebuild…');
  execSync('npm run db:setup', { cwd: serverDir, stdio: 'inherit' });

  appendPreservedEnv(rootEnv, preserved);
}

main();
