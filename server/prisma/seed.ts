import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../src/lib/auth.js';
import { env } from '../src/env.js';

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findFirst({ where: { role: Role.ADMIN } });
  if (existingAdmin) {
    console.log(`[seed] Admin already exists: ${existingAdmin.email}`);
    return;
  }

  const passwordHash = await hashPassword(env.seedAdmin.password);
  const admin = await prisma.user.create({
    data: {
      email: env.seedAdmin.email.toLowerCase(),
      name: env.seedAdmin.name,
      role: Role.ADMIN,
      passwordHash,
    },
  });
  console.log(`[seed] Created admin ${admin.email} (change the password immediately).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
