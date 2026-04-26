import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { sendSatisfactionSurveyEmail } from './mailer.js';

export interface RunResult {
  considered: number;
  emailed: number;
  skippedAlreadySent: number;
  errors: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Cron entry — finds projects that flipped to COMPLETE more than
// `delayDays` ago, doesn't have a survey row yet, and creates one + emails
// the customer the link. Default 14 days so the dust settles before we
// poke the customer (also keeps the request out of the same week as the
// review-request email so they don't feel spammed).
export async function runSatisfactionSurveys(opts: { delayDays?: number } = {}): Promise<RunResult> {
  const delayDays = opts.delayDays ?? 14;
  const now = new Date();
  const cutoff = new Date(now.getTime() - delayDays * DAY_MS);

  // We need a "marked complete at" timestamp — use Project.updatedAt as a
  // proxy since flipping status updates that. That's imperfect (any later
  // edit pushes it forward), but the alternative is adding a dedicated
  // completedAt column purely for this cron, which is overkill. To avoid
  // missing surveys when admin edits a project months later, we ALSO
  // require !satisfactionSurvey — i.e. the cron only fires once per
  // project regardless.
  const candidates = await prisma.project.findMany({
    where: {
      status: 'COMPLETE',
      updatedAt: { lt: cutoff },
      satisfactionSurvey: null,
    },
    include: { customer: { select: { id: true, name: true, email: true } } },
  });

  const result: RunResult = {
    considered: candidates.length,
    emailed: 0,
    skippedAlreadySent: 0,
    errors: 0,
  };

  for (const project of candidates) {
    try {
      const rawToken = crypto.randomBytes(24).toString('base64url');
      const tokenHash = hashToken(rawToken);
      await prisma.satisfactionSurvey.create({
        data: {
          projectId: project.id,
          customerId: project.customer.id,
          tokenHash,
          sentAt: new Date(),
        },
      });
      const surveyUrl = `${env.appUrl}/survey/${rawToken}`;
      await sendSatisfactionSurveyEmail({
        to: project.customer.email,
        customerName: project.customer.name,
        projectName: project.name,
        surveyUrl,
      });
      result.emailed += 1;
    } catch (err) {
      console.warn('[satisfaction-surveys] failed for', project.id, err);
      result.errors += 1;
    }
  }
  return result;
}
