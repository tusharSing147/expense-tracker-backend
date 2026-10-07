import { prisma } from '../../src/config/prisma';

export async function resetDb(): Promise<void> {
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.budget.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}
