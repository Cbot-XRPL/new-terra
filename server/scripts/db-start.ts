// Long-running embedded Postgres for local dev. Started by `npm run dev` in
// parallel with the API + client. Data persists in server/.pgdata/. Stop with
// Ctrl+C — we cleanly shut down PG so the data dir doesn't get corrupted.
//
// On the VM you don't run this — DATABASE_URL points at the real Postgres
// install instead. See DEPLOY.md.

import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', '.pgdata');
const port = Number(process.env.LOCAL_PG_PORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  // Force UTF-8 + C locale so the cluster can store the full Unicode
  // range — including emojis. The Windows default (WIN1252) silently
  // rejects 4-byte UTF-8 sequences like 🎉.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

async function main() {
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log(`[db] no data dir at ${dataDir} — initialising…`);
    await pg.initialise();
  }

  await pg.start();
  console.log(`[db] embedded postgres ready on localhost:${port}`);
  console.log(`[db] data: ${dataDir}`);

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[db] ${signal} — stopping postgres…`);
    try {
      await pg.stop();
    } catch (err) {
      console.warn('[db] stop failed:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.stdin.resume();
}

main().catch((err) => {
  console.error('[db] failed to start:', err);
  process.exit(1);
});
