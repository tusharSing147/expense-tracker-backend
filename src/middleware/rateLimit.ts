import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

export function createRateLimiter(opts: {
  windowMs: number;
  limit: number;
  skip?: () => boolean;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
      });
    },
    ...(opts.skip ? { skip: opts.skip } : {}),
  });
}

const skipInTest = (): boolean => env.NODE_ENV === 'test';

export const globalLimiter: RequestHandler = createRateLimiter({
  windowMs: 60_000,
  limit: 100,
  skip: skipInTest,
});

export const authLimiter: RequestHandler = createRateLimiter({
  windowMs: 15 * 60_000,
  limit: 10,
  skip: skipInTest,
});

export const refreshLimiter: RequestHandler = createRateLimiter({
  windowMs: 15 * 60_000,
  limit: 30,
  skip: skipInTest,
});
