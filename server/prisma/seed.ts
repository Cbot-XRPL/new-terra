import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../src/lib/auth.js';
import { env } from '../src/env.js';
import { STANDARD_CONTRACT_BODY, STANDARD_CONTRACT_VARIABLES } from './contractTemplate.js';

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
  let admin;
  if (existingAdmin) {
    console.log(`[seed] Admin already exists: ${existingAdmin.email}`);
    admin = existingAdmin;
  } else {
    const passwordHash = await hashPassword(env.seedAdmin.password);
    admin = await prisma.user.create({
      data: {
        email: env.seedAdmin.email.toLowerCase(),
        name: env.seedAdmin.name,
        role: Role.ADMIN,
        passwordHash,
      },
    });
    console.log(`[seed] Created admin ${admin.email} (change the password immediately).`);
  }

  // Plant the baseline expense / budget categories if missing. The
  // estimate→budget flow groups lines by these names and creates matching
  // ProjectBudgetLine rows; having Labor + Materials seeded means a fresh
  // install doesn't auto-create them on first conversion.
  for (const name of ['Labor', 'Materials', 'Subcontractors', 'Fees']) {
    const existing = await prisma.expenseCategory.findFirst({ where: { name } });
    if (!existing) {
      await prisma.expenseCategory.create({ data: { name } });
      console.log(`[seed] Created expense category "${name}".`);
    }
  }

  // Plant the standard residential construction template if no template
  // exists yet. Admin can edit the body in the Templates page later.
  const existingTpl = await prisma.contractTemplate.findFirst();
  if (!existingTpl) {
    await prisma.contractTemplate.create({
      data: {
        name: 'Standard residential construction agreement',
        description:
          'Generic residential construction contract — edit the body and variables to match your standard wording.',
        body: STANDARD_CONTRACT_BODY,
        variables: STANDARD_CONTRACT_VARIABLES,
        isDefaultForEstimateAccept: true,
        createdById: admin.id,
      },
    });
    console.log('[seed] Created default contract template.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
