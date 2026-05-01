// Regional-pricing helpers. Two read paths the estimator uses to seed
// per-line unit prices:
//
//   1. latestMaterialPrice(productId, zip)
//      Returns the freshest MaterialPriceSample for the given product
//      whose zipPrefix matches the first 3 digits of the customer's ZIP.
//      Falls back to null when no sample exists; the caller then defers
//      to the catalog default.
//
//   2. wageMultiplierFor(socCode, zip)
//      Multiplier applied to a product's defaultLaborCents so labor is
//      priced regionally. Returns 1.0 (no adjustment) whenever the
//      regional or national row is missing — never throws, never blocks
//      the estimate flow.
//
// All Prisma access is cast through `(prisma as any)` because both new
// models are added in this same change. The deploy script regenerates
// the client at boot, but the TS build must pass before then.

import { prisma } from '../db.js';

// Normalize a ZIP-ish input down to its 3-digit prefix. Tolerates the
// "12345-6789" extended form, surrounding whitespace, and short ZIPs.
// Returns "" when nothing parseable is supplied so the caller can short-
// circuit lookups.
export function zipPrefixOf(zip: string | null | undefined): string {
  if (!zip) return '';
  // Pull the first run of digits; ZIPs in the wild come with dashes,
  // spaces, or country prefixes the customer typed in.
  const m = String(zip).match(/\d+/);
  if (!m) return '';
  return m[0].slice(0, 3).padStart(3, '0').slice(0, 3);
}

export async function latestMaterialPrice(
  productId: string,
  zip: string | null | undefined,
): Promise<number | null> {
  const prefix = zipPrefixOf(zip);
  if (!prefix || !productId) return null;
  try {
    const row = await (prisma as any).materialPriceSample.findFirst({
      where: { productId, zipPrefix: prefix },
      orderBy: { fetchedAt: 'desc' },
      select: { unitPriceCents: true },
    });
    return row ? row.unitPriceCents : null;
  } catch {
    // Defensive — a missing model (pre-`prisma generate`) shouldn't kill
    // estimate creation. Treat as "no sample" and fall back to defaults.
    return null;
  }
}

export async function wageMultiplierFor(
  socCode: string,
  zip: string | null | undefined,
): Promise<number> {
  const prefix = zipPrefixOf(zip);
  if (!prefix || !socCode) return 1.0;
  try {
    const [regional, national] = await Promise.all([
      (prisma as any).laborWageRegion.findFirst({
        where: { socCode, zipPrefix: prefix },
        orderBy: { fetchedAt: 'desc' },
        select: { meanHourlyCents: true },
      }),
      (prisma as any).laborWageRegion.findFirst({
        where: { socCode, zipPrefix: '000' },
        orderBy: { fetchedAt: 'desc' },
        select: { meanHourlyCents: true },
      }),
    ]);
    if (!regional || !national || !national.meanHourlyCents) return 1.0;
    const ratio = regional.meanHourlyCents / national.meanHourlyCents;
    // Sanity-clamp: extreme outliers in the wage data are almost always
    // a typo on the import side. 0.5–2.0x covers the real spread between
    // rural Mississippi and SF Bay Area roofing labor.
    if (!Number.isFinite(ratio) || ratio <= 0) return 1.0;
    return Math.max(0.5, Math.min(2.0, ratio));
  } catch {
    return 1.0;
  }
}
