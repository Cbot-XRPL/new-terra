// One-shot diagnostic: query Resend for the verified domains, then
// optionally send a test email to the admin's address. Surfaces exactly
// where the email flow is in your account so we know what to change.
//
// Run: DATABASE_URL=… RESEND_API_KEY=… npx tsx prisma/resend-diagnose.ts

import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;
const fromConfigured = process.env.RESEND_FROM ?? 'New Terra Construction <onboarding@resend.dev>';
const testTo = process.env.SEED_ADMIN_EMAIL ?? 'admin@newterraconstruction.com';

if (!apiKey) {
  console.error('[diagnose] RESEND_API_KEY is not set in env.');
  process.exit(1);
}

const resend = new Resend(apiKey);

async function main() {
  console.log('=== Resend account diagnostic ===');
  console.log(`Configured RESEND_FROM: ${fromConfigured}`);

  // 1. Try listing domains (will fail with restricted/sending-only keys —
  //    that's OK, we still try the send below).
  try {
    const domains = await resend.domains.list();
    if (domains.error) {
      console.log(
        `(Skipping domain list — key is sending-only: ${domains.error.message ?? domains.error.name})`,
      );
    } else {
      const list = (domains.data as any)?.data ?? domains.data ?? [];
      if (Array.isArray(list) && list.length > 0) {
        console.log(`\nDomains in this Resend account (${list.length}):`);
        for (const d of list) {
          console.log(`  - ${d.name}  status=${d.status}`);
        }
      }
    }
  } catch (err: any) {
    console.log(`(Domain list skipped: ${err?.message ?? err})`);
  }

  // 2. Send a test email
  console.log(`\n--- Test send to ${testTo} ---`);
  const result = await resend.emails.send({
    from: fromConfigured,
    to: testTo,
    subject: 'New Terra — Resend connectivity test',
    text:
      'This is an automated diagnostic from your New Terra portal.\n\n' +
      `Sender: ${fromConfigured}\n` +
      `If you got this, server-side Resend is wired correctly.\n` +
      'Reply to this email is not monitored.\n',
  });
  if (result.error) {
    console.error('[diagnose] send error:', result.error);
    console.error(
      'Common causes:\n' +
      '  - sender domain not verified yet (check status above)\n' +
      '  - using onboarding@resend.dev → Resend only delivers to your account email\n' +
      '  - typo in the from email\n',
    );
    return;
  }
  console.log('[diagnose] send queued, id:', (result.data as any)?.id);
  console.log('Check your inbox (or Resend dashboard → Logs) within ~10s.');
}

main().catch((e) => {
  console.error('[diagnose] fatal:', e);
  process.exit(1);
});
