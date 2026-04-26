import nodemailer from 'nodemailer';
import { env } from '../env.js';

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export async function sendInviteEmail(to: string, inviteUrl: string, role: string) {
  const subject = 'You have been invited to the New Terra Construction portal';
  const text = `You've been invited as a ${role.toLowerCase()}.\n\nAccept your invite and set your password:\n${inviteUrl}\n\nThis link expires in 7 days.`;

  if (!transporter) {
    // Dev fallback: log the invite link so the admin can copy it manually.
    console.log('[mailer:dev] Would send invite to', to);
    console.log('[mailer:dev]', inviteUrl);
    return;
  }

  await transporter.sendMail({
    to,
    from: env.smtp.from,
    subject,
    text,
  });
}

export async function sendContractInviteEmail(input: {
  to: string;
  customerName: string;
  contractName: string;
  contractId: string;
  sentByName: string;
}) {
  const url = `${env.appUrl}/portal/contracts/${input.contractId}`;
  const subject = `New contract from New Terra Construction: ${input.contractName}`;
  const text = `Hi ${input.customerName},\n\n${input.sentByName} has sent you a contract for review.\n\nReview and sign here:\n${url}\n\nIf you have questions, reply to this email or call us.\n\n— New Terra Construction`;

  if (!transporter) {
    console.log('[mailer:dev] Contract invite to', input.to);
    console.log('[mailer:dev]', url);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendContractDecidedEmail(input: {
  to: string;
  repName: string;
  customerName: string;
  contractName: string;
  contractId: string;
  outcome: 'signed' | 'declined';
  declineReason?: string | null;
}) {
  const url = `${env.appUrl}/portal/contracts/${input.contractId}`;
  const subject =
    input.outcome === 'signed'
      ? `${input.customerName} signed: ${input.contractName}`
      : `${input.customerName} declined: ${input.contractName}`;
  const lines = [
    `Hi ${input.repName},`,
    '',
    `${input.customerName} has ${input.outcome} the contract "${input.contractName}".`,
    input.outcome === 'declined' && input.declineReason
      ? `Reason given: ${input.declineReason}`
      : null,
    '',
    `View the audit trail: ${url}`,
    '',
    '— New Terra Construction',
  ].filter((l): l is string => l !== null);
  const text = lines.join('\n');

  if (!transporter) {
    console.log('[mailer:dev] Contract', input.outcome, 'notice to', input.to);
    console.log('[mailer:dev]', url);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendContractReminderEmail(input: {
  to: string;
  customerName: string;
  contractName: string;
  contractId: string;
  daysOpen: number;
}) {
  const url = `${env.appUrl}/portal/contracts/${input.contractId}`;
  const subject = `Reminder: please review your contract — ${input.contractName}`;
  const text = `Hi ${input.customerName},\n\nIt's been ${input.daysOpen} days since we sent over your contract. When you have a moment, please review and sign here:\n${url}\n\nIf anything needs changing or you have questions, just reply.\n\n— New Terra Construction`;

  if (!transporter) {
    console.log('[mailer:dev] Contract reminder to', input.to);
    console.log('[mailer:dev]', url);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendPaymentReceiptEmail(input: {
  to: string;
  customerName: string;
  invoiceNumber: string;
  receiptNumber: string;
  amountCents: number;
  method: string;
  fullyPaid: boolean;
  balanceCents: number;
  pdfBuffer: Buffer;
}) {
  const dollars = `$${(input.amountCents / 100).toFixed(2)}`;
  const balance = `$${(input.balanceCents / 100).toFixed(2)}`;
  const subject = input.fullyPaid
    ? `Receipt: ${input.invoiceNumber} paid in full`
    : `Receipt: ${dollars} payment on ${input.invoiceNumber}`;
  const tail = input.fullyPaid
    ? `Invoice ${input.invoiceNumber} is now paid in full — thank you!`
    : `Remaining balance on invoice ${input.invoiceNumber}: ${balance}.`;
  const text = `Hi ${input.customerName},\n\nThanks for your ${input.method.toLowerCase()} payment of ${dollars}. The PDF receipt (${input.receiptNumber}) is attached for your records.\n\n${tail}\n\n— New Terra Construction`;

  if (!transporter) {
    console.log('[mailer:dev] Payment receipt to', input.to, '·', input.receiptNumber, `(${input.pdfBuffer.length} bytes)`);
    return;
  }
  await transporter.sendMail({
    to: input.to,
    from: env.smtp.from,
    subject,
    text,
    attachments: [
      {
        filename: `${input.receiptNumber}.pdf`,
        content: input.pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

export async function sendInvoiceReminderEmail(input: {
  to: string;
  customerName: string;
  invoiceNumber: string;
  invoiceId: string;
  amountDueCents: number;
  dueAt: Date | null;
  // 'upcoming' = due in the next few days; 'overdue' = past due. Drives the
  // tone of the email so we don't sound aggressive on a not-yet-due nudge.
  kind: 'upcoming' | 'overdue';
  daysOffset: number; // upcoming: days until due; overdue: days past due
  paymentUrl: string | null;
}) {
  const url = `${env.appUrl}/portal/invoices`;
  const dueLine = input.dueAt ? ` (due ${input.dueAt.toLocaleDateString()})` : '';
  const amountStr = `$${(input.amountDueCents / 100).toFixed(2)}`;
  const subject = input.kind === 'upcoming'
    ? `Friendly reminder: invoice ${input.invoiceNumber} due soon`
    : `Past-due notice: invoice ${input.invoiceNumber} (${input.daysOffset}d overdue)`;

  const body = input.kind === 'upcoming'
    ? `Hi ${input.customerName},\n\nJust a heads-up that invoice ${input.invoiceNumber} for ${amountStr}${dueLine} is coming up in ${input.daysOffset} days. You can review it here:\n${url}\n\n${input.paymentUrl ? `Pay now: ${input.paymentUrl}\n\n` : ''}Reply to this email if you have any questions.\n\n— New Terra Construction`
    : `Hi ${input.customerName},\n\nOur records show invoice ${input.invoiceNumber} for ${amountStr}${dueLine} is now ${input.daysOffset} days past due.\n\nPlease review here:\n${url}\n\n${input.paymentUrl ? `Pay now: ${input.paymentUrl}\n\n` : ''}If you've already sent payment via check or Zelle, please reply with the reference so we can match it up.\n\n— New Terra Construction`;

  if (!transporter) {
    console.log(`[mailer:dev] Invoice ${input.kind} reminder to`, input.to, '·', input.invoiceNumber);
    console.log('[mailer:dev]', url);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text: body });
}

export async function sendLaborBudgetAlertEmail(input: {
  to: string;
  pmName: string;
  projectName: string;
  projectId: string;
  laborSpentCents: number;
  laborBudgetCents: number;
}) {
  const pct = Math.round((input.laborSpentCents / input.laborBudgetCents) * 100);
  const url = `${env.appUrl}/portal/projects/${input.projectId}`;
  const subject = `Labor-budget alert: ${input.projectName} at ${pct}%`;
  const text = `Hi ${input.pmName},\n\nLabor cost on ${input.projectName} just crossed 80% of the labor budget:\n\n  Spent:  $${(input.laborSpentCents / 100).toFixed(2)}\n  Budget: $${(input.laborBudgetCents / 100).toFixed(2)}  (${pct}%)\n\nProject: ${url}\n\nMight be a good time to glance at outstanding tasks before hours blow past 100%.\n\n— New Terra Construction`;
  if (!transporter) {
    console.log('[mailer:dev] Labor-budget alert to', input.to, '·', input.projectName, `(${pct}%)`);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendSatisfactionSurveyEmail(input: {
  to: string;
  customerName: string;
  projectName: string;
  surveyUrl: string;
}) {
  const subject = `How did we do on ${input.projectName}? Quick 30-sec survey`;
  const text = `Hi ${input.customerName},\n\nIt's been a couple weeks since we wrapped ${input.projectName}, and we'd love to know how it's holding up.\n\nWould you take 30 seconds to drop a score (0–10) and any feedback?\n\n${input.surveyUrl}\n\nWe read every response. Thanks for trusting us.\n\n— New Terra Construction`;
  if (!transporter) {
    console.log('[mailer:dev] Satisfaction survey to', input.to, '·', input.projectName);
    console.log('[mailer:dev]', input.surveyUrl);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendReviewRequestEmail(input: {
  to: string;
  customerName: string;
  projectName: string;
  googleReviewUrl: string | null;
  yelpReviewUrl: string | null;
}) {
  const subject = `Thanks from New Terra Construction — would you mind a quick review?`;
  const links: string[] = [];
  if (input.googleReviewUrl) links.push(`Google: ${input.googleReviewUrl}`);
  if (input.yelpReviewUrl) links.push(`Yelp: ${input.yelpReviewUrl}`);
  const linkBlock = links.length > 0
    ? `\n\nIf you have a minute, a quick review goes a long way:\n${links.join('\n')}\n`
    : '';
  const text = `Hi ${input.customerName},\n\nThanks for trusting us with ${input.projectName}. It was a pleasure working with you, and we hope the result feels exactly the way you imagined.${linkBlock}\nReply if anything looks off after the dust settles — we'd rather hear about it now than later.\n\n— New Terra Construction`;

  if (!transporter) {
    console.log('[mailer:dev] Review request to', input.to, '·', input.projectName);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendStaleLeadEmail(input: {
  to: string;
  ownerName: string;
  leadName: string;
  leadId: string;
  status: string;
  daysQuiet: number;
}) {
  const url = `${env.appUrl}/portal/leads/${input.leadId}`;
  const subject = `Stale lead: ${input.leadName} (${input.daysQuiet}d quiet)`;
  const text = `Hi ${input.ownerName},\n\nThis lead has been in ${input.status.toLowerCase()} for ${input.daysQuiet} days without an update:\n\n${input.leadName}\n${url}\n\nMight be worth a touch. Update the status or log an activity to clear it from this list.\n\n— New Terra Construction`;

  if (!transporter) {
    console.log('[mailer:dev] Stale-lead nudge to', input.to);
    console.log('[mailer:dev]', url);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
  ttlMinutes: number;
}) {
  const subject = 'Reset your New Terra Construction password';
  const text = `Hi ${input.name},\n\nWe received a request to reset your password. If this was you, click the link below within ${input.ttlMinutes} minutes:\n\n${input.resetUrl}\n\nIf you did not request this, you can safely ignore this email — your password is unchanged.\n\n— New Terra Construction`;

  if (!transporter) {
    console.log('[mailer:dev] Password reset link to', input.to);
    console.log('[mailer:dev]', input.resetUrl);
    return;
  }
  await transporter.sendMail({ to: input.to, from: env.smtp.from, subject, text });
}

export async function sendInquiryEmail(input: {
  name: string;
  email: string;
  phone?: string;
  message: string;
}) {
  const subject = `Inquiry from ${input.name}`;
  const text = `Name: ${input.name}\nEmail: ${input.email}\nPhone: ${input.phone ?? '—'}\n\n${input.message}`;
  const to = process.env.INQUIRY_TO ?? 'sales@newterraconstruction.com';

  if (!transporter) {
    console.log('[mailer:dev] Inquiry submission for', to);
    console.log('[mailer:dev]', text);
    return;
  }

  await transporter.sendMail({
    to,
    from: env.smtp.from,
    replyTo: input.email,
    subject,
    text,
  });
}
