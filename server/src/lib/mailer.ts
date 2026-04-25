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
