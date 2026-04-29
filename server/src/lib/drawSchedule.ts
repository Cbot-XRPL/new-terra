import { ContractStatus } from '@prisma/client';
import { prisma } from '../db.js';

interface DrawForRender {
  order: number;
  name: string;
  amountCents: number;
  description?: string | null;
}

/**
 * Render a draw schedule as a plain-text block for substitution into the
 * contract body via the `{{draw_schedule}}` placeholder. Sorted by order.
 */
export function formatDrawSchedule(draws: DrawForRender[]): string {
  if (draws.length === 0) return '(No draw schedule defined.)';
  const total = draws.reduce((s, d) => s + d.amountCents, 0);
  const sorted = [...draws].sort((a, b) => a.order - b.order);
  const lines = sorted.map((d, i) => {
    const amount = `$${(d.amountCents / 100).toFixed(2)}`;
    const detail = d.description ? ` — ${d.description}` : '';
    return `  ${i + 1}. ${d.name}: ${amount}${detail}`;
  });
  lines.push('');
  lines.push(`  Total: $${(total / 100).toFixed(2)}`);
  return lines.join('\n');
}

/**
 * Substitute {{key}} placeholders in `body` with values. Two keys are
 * auto-derived from `draws` if the caller didn't pass them explicitly:
 *   - draw_schedule  — full text-table of the schedule
 *   - contract_total — sum of all draw amounts (formatted as $X,XXX.XX)
 */
export function renderContractBody(
  body: string,
  values: Record<string, string>,
  draws: DrawForRender[],
): string {
  const total = draws.reduce((s, d) => s + d.amountCents, 0);
  const totalFormatted = total > 0 ? `$${(total / 100).toFixed(2)}` : '';
  const enriched: Record<string, string> = {
    ...values,
    draw_schedule: values.draw_schedule || formatDrawSchedule(draws),
    contract_total: values.contract_total || totalFormatted,
  };
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key: string) => {
    const v = enriched[key];
    return typeof v === 'string' && v.length > 0 ? v : `[${key}]`;
  });
}

/**
 * Re-render and persist the bodySnapshot of a contract. Called whenever its
 * draws change so the customer never sees a stale schedule. No-op for
 * contracts that have already been sent / signed (snapshot is locked) or
 * for contracts with no underlying template.
 */
export async function regenerateContractBody(contractId: string): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { template: true },
  });
  if (!contract || !contract.template) return;
  if (contract.status !== ContractStatus.DRAFT) return;
  // Sales rep hand-edited the body — they're the source of truth now.
  if (contract.bodyOverridden) return;
  const draws = await prisma.draw.findMany({
    where: { contractId },
    orderBy: { order: 'asc' },
    select: { order: true, name: true, amountCents: true, description: true },
  });
  const values = (contract.variableValues ?? {}) as Record<string, string>;
  const body = renderContractBody(contract.template.body, values, draws);
  await prisma.contract.update({
    where: { id: contract.id },
    data: { bodySnapshot: body },
  });
}
