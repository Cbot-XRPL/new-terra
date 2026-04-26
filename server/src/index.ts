import cron from 'node-cron';
import { env } from './env.js';
import { createApp } from './app.js';
import { notifyStaleLeads, remindStaleContracts } from './lib/reminders.js';

const app = createApp();

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

// Same shape for the stale-lead nudge. STALE_LEAD_CRON e.g. "0 8 * * 1-5"
// fires the email at 8am on weekdays.
const staleLeadSchedule = process.env.STALE_LEAD_CRON;
if (staleLeadSchedule) {
  if (cron.validate(staleLeadSchedule)) {
    cron.schedule(staleLeadSchedule, () => {
      notifyStaleLeads()
        .then((r) => console.log('[cron:stale-leads]', r))
        .catch((err) => console.warn('[cron:stale-leads] failed', err));
    });
    console.log(`[cron] stale-lead nudges scheduled "${staleLeadSchedule}"`);
  } else {
    console.warn(`[cron] STALE_LEAD_CRON="${staleLeadSchedule}" is not a valid expression; skipping`);
  }
}
