import { prisma } from '../db.js';
import { sendLaborBudgetAlertEmail } from './mailer.js';

export interface RunResult {
  considered: number;
  alerted: number;
  skippedAlreadySent: number;
  skippedNoBudget: number;
  skippedUnderThreshold: number;
  skippedNoPm: number;
}

const ALERT_THRESHOLD_PCT = 80;

// Cron entry point + on-demand admin trigger. Walks every active project
// with a labor budget set, sums labor cost from closed time entries
// (minutes/60 × hourlyRateCents), and emails the assigned PM when the
// project crosses 80% of the budget. Stamps laborAlertSentAt so the same
// project doesn't get re-alerted on every cron tick — admin clears the
// stamp by raising the budget (which clears it server-side) or by
// blanking it manually if needed.
export async function runLaborBudgetAlerts(): Promise<RunResult> {
  const candidates = await prisma.project.findMany({
    where: {
      archivedAt: null,
      laborBudgetCents: { not: null, gt: 0 },
      laborAlertSentAt: null,
    },
    include: {
      projectManager: { select: { id: true, name: true, email: true } },
      timeEntries: {
        where: { endedAt: { not: null } },
        select: { minutes: true, hourlyRateCents: true },
      },
    },
  });

  const result: RunResult = {
    considered: candidates.length,
    alerted: 0,
    skippedAlreadySent: 0,
    skippedNoBudget: 0,
    skippedUnderThreshold: 0,
    skippedNoPm: 0,
  };

  for (const project of candidates) {
    const laborCents = project.timeEntries.reduce(
      (s, t) => s + Math.round((t.minutes / 60) * t.hourlyRateCents),
      0,
    );
    const budget = project.laborBudgetCents ?? 0;
    if (budget <= 0) { result.skippedNoBudget += 1; continue; }
    const pct = (laborCents / budget) * 100;
    if (pct < ALERT_THRESHOLD_PCT) { result.skippedUnderThreshold += 1; continue; }
    if (!project.projectManager) { result.skippedNoPm += 1; continue; }
    try {
      await sendLaborBudgetAlertEmail({
        to: project.projectManager.email,
        pmName: project.projectManager.name,
        projectName: project.name,
        projectId: project.id,
        laborSpentCents: laborCents,
        laborBudgetCents: budget,
      });
      await prisma.project.update({
        where: { id: project.id },
        data: { laborAlertSentAt: new Date() },
      });
      result.alerted += 1;
    } catch (err) {
      console.warn('[labor-alert] email failed for', project.id, err);
    }
  }
  return result;
}
