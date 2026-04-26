import cron from 'node-cron';
import { env } from './env.js';
import { createApp } from './app.js';
import { notifyStaleLeads, remindInvoices, remindStaleContracts } from './lib/reminders.js';

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

// Invoice reminders — flips SENT → OVERDUE once dueAt passes and emails
// customers about upcoming-due + overdue invoices. INVOICE_REMINDER_CRON
// e.g. "0 9 * * 1-5" runs every weekday at 9am. Cooldown is 3 days inside
// the helper so a single invoice never gets emailed more than ~twice a week.
const invoiceReminderSchedule = process.env.INVOICE_REMINDER_CRON;
if (invoiceReminderSchedule) {
  if (cron.validate(invoiceReminderSchedule)) {
    cron.schedule(invoiceReminderSchedule, () => {
      remindInvoices()
        .then((r) => console.log('[cron:invoice-reminders]', r))
        .catch((err) => console.warn('[cron:invoice-reminders] failed', err));
    });
    console.log(`[cron] invoice reminders scheduled "${invoiceReminderSchedule}"`);
  } else {
    console.warn(`[cron] INVOICE_REMINDER_CRON="${invoiceReminderSchedule}" is not a valid expression; skipping`);
  }
}
