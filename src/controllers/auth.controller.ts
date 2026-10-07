import { randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { REFRESH_COOKIE_NAME } from '../config/constants';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import {
  clearRefreshCookie,
  hashToken,
  setRefreshCookie,
  signAccessToken,
  signRefreshToken,
  timingSafeEqualHex,
  verifyRefreshToken,
} from '../utils/tokens';
import type { LoginInput, RegisterInput } from '../validators/auth.validator';

const USER_SELECT = { id: true, name: true, email: true, createdAt: true } as const;

type PublicUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  if (dummyHashPromise === null) {
    dummyHashPromise = bcrypt.hash(randomBytes(16).toString('hex'), env.BCRYPT_COST);
  }
  return dummyHashPromise;
}

function readRefreshCookie(req: Request): string | null {
  const raw: unknown = req.cookies[REFRESH_COOKIE_NAME];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function clientMeta(req: Request): { userAgent: string | null; ip: string | null } {
  return {
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
    ip: req.ip?.slice(0, 64) ?? null,
  };
}

async function issueRefreshToken(
  tx: Prisma.TransactionClient,
  opts: { userId: string; familyId: string; jti: string; userAgent: string | null; ip: string | null },
): Promise<string> {
  const rawRefresh = signRefreshToken({ sub: opts.userId, jti: opts.jti, fam: opts.familyId });
  await tx.refreshToken.create({
    data: {
      id: opts.jti,
      familyId: opts.familyId,
      tokenHash: hashToken(rawRefresh),
      userId: opts.userId,
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000),
      userAgent: opts.userAgent,
      ip: opts.ip,
    },
  });
  return rawRefresh;
}

function invalidCredentials(res: Response): void {
  res.status(401).json({
    error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterInput;
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_COST);
  const meta = clientMeta(req);

  try {
    const { user, rawRefresh } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: input.name, email: input.email, passwordHash },
        select: USER_SELECT,
      });
      const jti = randomUUID();
      const fam = randomUUID();
      const raw = await issueRefreshToken(tx, { userId: created.id, familyId: fam, jti, ...meta });
      return { user: created, rawRefresh: raw };
    });

    setRefreshCookie(res, rawRefresh);
    res.status(201).json({ user, accessToken: signAccessToken(user.id) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({
        error: { code: 'EMAIL_TAKEN', message: 'Email already registered' },
      });
      return;
    }
    throw err;
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = req.body as LoginInput;

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...USER_SELECT, passwordHash: true, failedLogins: true, lockedUntil: true },
  });

  if (user === null) {
    await bcrypt.compare(input.password, await getDummyHash());
    invalidCredentials(res);
    return;
  }

  if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    res.status(423).json({
      error: {
        code: 'ACCOUNT_LOCKED',
        message: `Account locked due to too many failed login attempts. Try again in ${minutes} minute(s).`,
      },
    });
    return;
  }

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) {
    const next = user.failedLogins + 1;
    if (next >= MAX_FAILED_LOGINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) },
      });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: next } });
    }
    invalidCredentials(res);
    return;
  }

  const meta = clientMeta(req);
  const { user: publicUser, rawRefresh }: { user: PublicUser; rawRefresh: string } =
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
      const jti = randomUUID();
      const fam = randomUUID();
      const raw = await issueRefreshToken(tx, { userId: user.id, familyId: fam, jti, ...meta });
      return {
        user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
        rawRefresh: raw,
      };
    });

  setRefreshCookie(res, rawRefresh);
  res.status(200).json({ user: publicUser, accessToken: signAccessToken(publicUser.id) });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const raw = readRefreshCookie(req);
  if (raw === null) {
    res.status(401).json({
      error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token provided' },
    });
    return;
  }

  const verified = verifyRefreshToken(raw);
  if (!verified.ok) {
    clearRefreshCookie(res);
    if (verified.reason === 'expired') {
      res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Refresh token expired' } });
    } else {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
    }
    return;
  }
  const claims = verified.claims;

  const row = await prisma.refreshToken.findUnique({ where: { id: claims.jti } });
  if (row === null) {
    clearRefreshCookie(res);
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
    return;
  }

  if (!timingSafeEqualHex(hashToken(raw), row.tokenHash)) {
    clearRefreshCookie(res);
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid refresh token' } });
    return;
  }

  if (row.revokedAt !== null) {
    await prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearRefreshCookie(res);
    res.status(401).json({
      error: { code: 'TOKEN_REUSED', message: 'Refresh token reuse detected' },
    });
    return;
  }

  if (row.expiresAt < new Date()) {
    clearRefreshCookie(res);
    res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Refresh token expired' } });
    return;
  }

  const meta = clientMeta(req);
  const newJti = randomUUID();
  const rotated = await prisma.$transaction(async (tx) => {
    const upd = await tx.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedBy: newJti },
    });
    if (upd.count === 0) {
      await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    const newRefresh = await issueRefreshToken(tx, {
      userId: row.userId,
      familyId: row.familyId,
      jti: newJti,
      ...meta,
    });
    return { newRefresh };
  });

  if (rotated === null) {
    clearRefreshCookie(res);
    res.status(401).json({
      error: { code: 'TOKEN_REUSED', message: 'Refresh token reuse detected' },
    });
    return;
  }

  setRefreshCookie(res, rotated.newRefresh);
  res.status(200).json({ accessToken: signAccessToken(row.userId) });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const raw = readRefreshCookie(req);
  if (raw !== null) {
    const verified = verifyRefreshToken(raw);
    if (verified.ok) {
      await prisma.refreshToken.updateMany({
        where: { id: verified.claims.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (userId === undefined) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (user === null) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Account not found' } });
    return;
  }
  res.status(200).json({ user });
}
