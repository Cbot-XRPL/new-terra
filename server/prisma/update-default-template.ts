// One-shot: replace the body + variables of the existing default contract
// template with the standard residential agreement defined in
// contractTemplate.ts. Idempotent — re-running just refreshes the body.
//
// Run: npm --workspace server run db:update-template

import { PrismaClient } from '@prisma/client';
import { STANDARD_CONTRACT_BODY, STANDARD_CONTRACT_VARIABLES } from './contractTemplate.js';

const prisma = new PrismaClient();

async function main() {
  // Prefer the template flagged as default-for-estimate-accept; fall back
  // to the most recently created template; create one if none exists.
  let tpl =
    (await prisma.contractTemplate.findFirst({ where: { isDefaultForEstimateAccept: true } })) ??
    (await prisma.contractTemplate.findFirst({ orderBy: { createdAt: 'desc' } }));

  if (!tpl) {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) {
      throw new Error('No admin user found — run db:seed first to create the bootstrap admin.');
    }
    tpl = await prisma.contractTemplate.create({
      data: {
        name: 'Standard residential construction agreement',
        description:
          'Generic residential construction contract — edit the body to match your actual wording.',
        body: STANDARD_CONTRACT_BODY,
        variables: STANDARD_CONTRACT_VARIABLES,
        isDefaultForEstimateAccept: true,
        createdById: admin.id,
      },
    });
    console.log(`[update-template] Created template "${tpl.name}" (${tpl.id}).`);
    return;
  }

  await prisma.contractTemplate.update({
    where: { id: tpl.id },
    data: {
      name: 'Standard residential construction agreement',
      description:
        'Generic residential construction contract — edit the body to match your actual wording.',
      body: STANDARD_CONTRACT_BODY,
      variables: STANDARD_CONTRACT_VARIABLES,
      isDefaultForEstimateAccept: true,
    },
  });
  console.log(`[update-template] Updated template "${tpl.name}" (${tpl.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
