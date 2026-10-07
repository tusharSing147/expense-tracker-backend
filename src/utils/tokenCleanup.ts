import { prisma } from '../config/prisma';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupExpiredTokens(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ONE_DAY_MS);
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}
