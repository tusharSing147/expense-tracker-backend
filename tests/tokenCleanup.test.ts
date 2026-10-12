import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { cleanupExpiredTokens } from '../src/utils/tokenCleanup';
import { resetDb } from './helpers/db';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('cleanupExpiredTokens', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('deletes only refresh tokens expired beyond the one-day grace window', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Cleanup User',
        email: `cleanup-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-bcrypt-hash',
      },
    });

    const expiredRow = await prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        familyId: randomUUID(),
        tokenHash: `hash-expired-${randomUUID()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() - 3 * DAY_MS),
      },
    });

    const liveRow = await prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        familyId: randomUUID(),
        tokenHash: `hash-live-${randomUUID()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });

    const deleted = await cleanupExpiredTokens();

    expect(deleted).toBe(1);
    expect(await prisma.refreshToken.findUnique({ where: { id: expiredRow.id } })).toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: liveRow.id } })).not.toBeNull();
  });
});
