import { createHash, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { JWT_AUDIENCE, JWT_ISSUER, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../config/constants';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  fam: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export type VerifyResult<T> = { ok: true; claims: T } | { ok: false; reason: 'expired' | 'invalid' };

// env validates JWT_ACCESS_EXPIRES against /^\d+[smhd]$/ (ms StringValue); plain `string` needs a cast.
type ExpiryOption = SignOptions['expiresIn'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: env.JWT_ACCESS_EXPIRES as ExpiryOption,
  });
}

export function signRefreshToken(input: { sub: string; jti: string; fam: string }): string {
  return jwt.sign({ sub: input.sub, jti: input.jti, fam: input.fam }, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: `${env.JWT_REFRESH_EXPIRES_DAYS}d` as ExpiryOption,
  });
}

function verifyToken<T extends object>(
  token: string,
  secret: string,
  isClaimShapeValid: (claims: T) => boolean,
): VerifyResult<T> {
  try {
    const decoded: unknown = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof decoded !== 'object' || decoded === null) {
      return { ok: false, reason: 'invalid' };
    }
    const claims = decoded as T;
    if (!isClaimShapeValid(claims)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, claims };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

export function verifyAccessToken(token: string): VerifyResult<AccessTokenClaims> {
  return verifyToken<AccessTokenClaims>(token, env.JWT_ACCESS_SECRET, (claims) =>
    isNonEmptyString(claims.sub),
  );
}

export function verifyRefreshToken(token: string): VerifyResult<RefreshTokenClaims> {
  return verifyToken<RefreshTokenClaims>(token, env.JWT_REFRESH_SECRET, (claims) =>
    isNonEmptyString(claims.sub) && isNonEmptyString(claims.jti) && isNonEmptyString(claims.fam),
  );
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: REFRESH_COOKIE_PATH,
    maxAge: env.JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: REFRESH_COOKIE_PATH,
  });
}
