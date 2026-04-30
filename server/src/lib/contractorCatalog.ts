import type { Prisma, User } from '@prisma/client';

/**
 * Ensure a catalog `Product` row exists for the given contractor or
 * employee user, mirroring their billing rate + trade. Idempotent:
 *
 *   - First call creates the row (linked via contractorUserId).
 *   - Subsequent calls update name / unit / price / category to track
 *     changes the admin made on the user record (rate change, trade
 *     change, etc.).
 *   - Skipped entirely for ADMIN / CUSTOMER users — they don't get billed
 *     against estimate lines.
 *   - Inactive users have their product flipped inactive too so they
 *     drop out of the picker without losing line history.
 *
 * The product's category is set to the user's tradeType when present so
 * a sales rep can find them by trade in the estimator combobox.
 */
export async function ensureContractorCatalogItem(
  tx: Prisma.TransactionClient,
  user: Pick<
    User,
    'id' | 'role' | 'name' | 'tradeType' | 'billingMode' |
    'hourlyRateCents' | 'dailyRateCents' | 'isActive'
  >,
): Promise<void> {
  // Only contractors + employees become labor catalog items. Admins
  // aren't billed against jobs; customers obviously aren't either.
  if (user.role !== 'SUBCONTRACTOR' && user.role !== 'EMPLOYEE') return;

  const isDaily = user.billingMode === 'DAILY';
  const unit = isDaily ? 'day' : 'hr';
  const priceCents = isDaily ? user.dailyRateCents : user.hourlyRateCents;
  const tradeLabel = user.tradeType ?? (user.role === 'EMPLOYEE' ? 'Labor' : 'Subcontractor');
  const productName = `${user.name} — ${tradeLabel} (${unit})`;

  const existing = await tx.product.findFirst({
    where: { contractorUserId: user.id },
    select: { id: true },
  });

  if (existing) {
    await tx.product.update({
      where: { id: existing.id },
      data: {
        name: productName,
        kind: 'labor',
        unit,
        defaultUnitPriceCents: priceCents,
        category: user.tradeType ?? 'Labor',
        active: user.isActive,
      },
    });
  } else {
    await tx.product.create({
      data: {
        name: productName,
        kind: 'labor',
        unit,
        defaultUnitPriceCents: priceCents,
        category: user.tradeType ?? 'Labor',
        contractorUserId: user.id,
        active: user.isActive,
      },
    });
  }
}
