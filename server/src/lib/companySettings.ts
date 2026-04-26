import type { CompanySettings } from '@prisma/client';
import { prisma } from '../db.js';

// Returns the singleton CompanySettings row, creating an empty one on first
// access. Lets every caller treat "settings exist" as an invariant — the UI
// just shows blank fields the admin can fill in later.
export async function getCompanySettings(): Promise<CompanySettings> {
  const existing = await prisma.companySettings.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
  return prisma.companySettings.create({ data: { id: 'default' } });
}
