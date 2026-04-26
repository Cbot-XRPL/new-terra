import cron from 'node-cron';
import { env } from './env.js';
import { createApp } from './app.js';
import { notifyStaleLeads, remindInvoices, remindStaleContracts } from './lib/reminders.js';
import { runRecurringInvoices } from './lib/recurringInvoices.js';
import { runSatisfactionSurveys } from './lib/satisfactionSurveys.js';
import { runLaborBudgetAlerts } from './lib/laborBudgetAlerts.js';

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

// Recurring invoices — checks every active template whose nextRunAt is
// past, generates a DRAFT invoice, advances nextRunAt by the frequency.
// RECURRING_INVOICE_CRON e.g. "0 6 * * *" runs every day at 6am. Cheap
// to run more often (rows are pre-filtered by index).
const recurringSchedule = process.env.RECURRING_INVOICE_CRON;
if (recurringSchedule) {
  if (cron.validate(recurringSchedule)) {
    cron.schedule(recurringSchedule, () => {
      runRecurringInvoices()
        .then((r) => console.log('[cron:recurring-invoices]', r))
        .catch((err) => console.warn('[cron:recurring-invoices] failed', err));
    });
    console.log(`[cron] recurring invoices scheduled "${recurringSchedule}"`);
  } else {
    console.warn(`[cron] RECURRING_INVOICE_CRON="${recurringSchedule}" is not a valid expression; skipping`);
  }
}

// Labor-budget alerts — emails the assigned PM when closed time-entry cost
// crosses 80% of the project's labor budget. Cheap enough to run hourly;
// the helper short-circuits via laborAlertSentAt so once-only per project.
const laborAlertSchedule = process.env.LABOR_ALERT_CRON;
if (laborAlertSchedule) {
  if (cron.validate(laborAlertSchedule)) {
    cron.schedule(laborAlertSchedule, () => {
      runLaborBudgetAlerts()
        .then((r) => console.log('[cron:labor-alerts]', r))
        .catch((err) => console.warn('[cron:labor-alerts] failed', err));
    });
    console.log(`[cron] labor-budget alerts scheduled "${laborAlertSchedule}"`);
  } else {
    console.warn(`[cron] LABOR_ALERT_CRON="${laborAlertSchedule}" is not a valid expression; skipping`);
  }
}

// Customer satisfaction survey — fires for projects that flipped to
// COMPLETE more than 14 days ago without a survey row yet. Same env-var
// cron pattern as the others; off by default in dev.
const surveySchedule = process.env.SATISFACTION_SURVEY_CRON;
if (surveySchedule) {
  if (cron.validate(surveySchedule)) {
    cron.schedule(surveySchedule, () => {
      runSatisfactionSurveys()
        .then((r) => console.log('[cron:satisfaction-surveys]', r))
        .catch((err) => console.warn('[cron:satisfaction-surveys] failed', err));
    });
    console.log(`[cron] satisfaction surveys scheduled "${surveySchedule}"`);
  } else {
    console.warn(`[cron] SATISFACTION_SURVEY_CRON="${surveySchedule}" is not a valid expression; skipping`);
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
